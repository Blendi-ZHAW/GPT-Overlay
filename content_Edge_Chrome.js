// path: public/js/llm-footprint-overlay.js
(function () {
  // ======== Konstanten (Studie + EU) ========
  const GPT4O_WH_SHORT  = 0.421;
  const GPT4O_WH_MEDIUM = 1.214;
  const GPT4O_WH_LONG   = 1.788;
  const EU_CIF_G_PER_KWH = 244;
  const EU_WUE_L_PER_KWH = 0.31;
  const UNCERTAINTY_PCT = 30;

  const SMARTPHONE_WH = 13;
  const CAR_G_PER_KM = 120;
  const SHOT_LITERS = 0.04;

  const SHORT_MAX_IN_CH = 400;
  const SHORT_MAX_OUT_CH = 1200;
  const MED_MAX_IN_CH = 4000;
  const MED_MAX_OUT_CH = 4000;

  // ---- Keys ----
  const TOTAL_KEY = "llmfo_total";
  const MIGRATION_FLAG = "llmfo_migrated_week_to_total_v1";
  const HIDDEN_KEY = "llmfo_hidden_v1";
  const UNLOCK_CODE = "4561";

  // --- helpers ---
  function classifyByIO(inChars, outChars) {
    if (inChars <= SHORT_MAX_IN_CH && outChars <= SHORT_MAX_OUT_CH) return "short";
    if (inChars <= MED_MAX_IN_CH && outChars <= MED_MAX_OUT_CH) return "medium";
    return "long";
  }
  function energyWhFromClass(c) {
    if (c === "short")  return GPT4O_WH_SHORT;
    if (c === "medium") return GPT4O_WH_MEDIUM;
    return GPT4O_WH_LONG;
  }
  function format(val, d = 2) { return Number(val).toFixed(d); }
  function formatLocale(val, d = 2, locale = "de-DE") {
    // WHY: Komma als Dezimaltrenner im UI
    return Number(val || 0).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function formatMLfromL(liters) { return (liters * 1000).toFixed(1) + " mL"; }
  function add(a, b) { return Number(a || 0) + Number(b || 0); }

  function estimateFromIO(inChars, outChars) {
    const klass = classifyByIO(inChars, outChars);
    const wh = energyWhFromClass(klass);
    const kWh = wh / 1000.0;
    return { klass, wh, g: kWh * EU_CIF_G_PER_KWH, l: kWh * EU_WUE_L_PER_KWH };
  }

  // ---- Datum & Zeit (lokal) ----
  function toYMD(d = new Date()) { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0"); return `${y}${m}${day}`; }
  function fromYMD(ymd){ return new Date(Number(ymd.slice(0,4)), Number(ymd.slice(4,6))-1, Number(ymd.slice(6,8))); }
  function addDays(date, days){ const d=new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate()+days); return d; }
  function formatLocalHHMMSS(d){ const hh=String(d.getHours()).padStart(2,"0"), mm=String(d.getMinutes()).padStart(2,"0"), ss=String(d.getSeconds()).padStart(2,"0"); return `${hh}:${mm}:${ss}`; }
  function csvDateLabel(ymd){ return `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}`; }

  function dayKey(d = new Date()) { return `llmfo_day_${toYMD(d)}`; }
  function weekKey(d = new Date()) {
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
    return `llmfo_week_${dt.getUTCFullYear()}_${String(weekNo).padStart(2, "0")}`;
  }

  function getAgg(key){ try{ return JSON.parse(localStorage.getItem(key) || '{"wh":0,"g":0,"l":0,"n":0}'); } catch{ return { wh:0,g:0,l:0,n:0 }; } }
  function setAgg(key, obj){ localStorage.setItem(key, JSON.stringify(obj)); }

  // "Erster Tag" (für lückenlosen CSV-Export)
  function ensureFirstDaySet(){ if (!localStorage.getItem("llmfo_csv_first_day")) localStorage.setItem("llmfo_csv_first_day", toYMD(new Date())); }

  // Promptzeit speichern
  function promptTimeKeyForText(text){ return `llmfo_pt_${hashText(text || "")}`; }
  function rememberPromptTimeIfNew(){
    const inText = getLastText("user").trim();
    if (!inText) return;
    const key = promptTimeKeyForText(inText);
    if (!localStorage.getItem(key)) localStorage.setItem(key, new Date().toISOString());
  }

  // Migration Woche -> TOTAL
  function migrateWeekToTotalOnce(){
    if (localStorage.getItem(MIGRATION_FLAG)) return;
    const wkKey = weekKey();
       const the_week = getAgg(wkKey);
    const totalAgg = getAgg(TOTAL_KEY);
    if (Number(totalAgg.n || 0) === 0 && Number(the_week.n || 0) > 0) {
      setAgg(TOTAL_KEY, { wh:Number(the_week.wh||0), g:Number(the_week.g||0), l:Number(the_week.l||0), n:Number(the_week.n||0) });
    }
    localStorage.setItem(MIGRATION_FLAG, "1");
  }

  // ====== Dark Theme Styles ======
  function injectStylesOnce(){
    if (document.getElementById("llmfo-style")) return;
    const css = `
      #llm-footprint-overlay{
        position:fixed; bottom:12px; right:12px; width:360px;
        background:#000; color:#fff; border:1px solid rgba(255,255,255,.12);
        border-radius:12px; padding:10px; box-shadow:0 10px 30px rgba(0,0,0,.6);
        font-family: system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans";
      }
      .llmfo-toprow{ margin-bottom:8px; }
      .llmfo-dot{ display:inline-block;width:10px;height:10px;border-radius:50%; }
      .llmfo-green{ background:#22c55e; } .llmfo-yellow{ background:#eab308; } .llmfo-red{ background:#ef4444; }

      /* Toolbar in zwei Reihen */
      .llmfo-toolbar{ display:flex; flex-direction:column; gap:6px; margin:6px 0 10px; }
      .llmfo-toolbar-row{ display:flex; gap:8px; align-items:center; }
      .llmfo-actions{ flex-wrap:nowrap; overflow-x:auto; white-space:nowrap; }

      .llmfo-pill{
        font-size:12px; line-height:1; padding:6px 10px; border-radius:9999px; border:1px solid rgba(255,255,255,.15);
        background:#0a0a0a; color:#fff; cursor:pointer; text-decoration:none; user-select:none;
      }
      .llmfo-pill:hover{ background:#111; }
      .llmfo-pill.is-active{ background:#1f2937; border-color:#334155; }
      #llmfo-unc.llmfo-pill{ cursor:default; background:#0b0b0b; border-style:dashed; opacity:.9; }

      .llmfo-visual-body{ display:flex; flex-direction:column; gap:12px; }
      .llmfo-card{
        width:100%; background:#111; border:1px solid rgba(255,255,255,.08);
        border-radius:12px; padding:14px; min-height:120px;
        display:flex; align-items:center;
      }
      .llmfo-flex{ display:flex; align-items:center; gap:14px; width:100%; }
      .llmfo-flex img{ width:56px; height:56px; }
      .llmfo-col{ display:flex; flex-direction:column; gap:6px; width:100%; }
      .llmfo-bignum{ font-size:32px; font-weight:800; line-height:1.1; }
      .llmfo-subtext{ font-size:14px; opacity:.85; }
      .llmfo-value{ font-size:14px; opacity:.85; }

      .llmfo-chip{ padding:8px 12px; border:1px solid rgba(255,255,255,.15); border-radius:9999px; background:#0a0a0a; color:#fff; }
      .hidden{ display:none !important; }

      /* farbige Metriken */
      .llmfo-colored-wh{ color:#60a5fa; font-weight:700; } /* Wh */
      .llmfo-colored-g{  color:#f59e0b; font-weight:700; } /* gCO2e */

      #llmfo-hide{ background:#1f2937 !important; }
    `;
    const style = document.createElement("style");
    style.id = "llmfo-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ===== Overlay Toggle =====
  function createToggleIcon(){
    if (document.getElementById("llmfo-toggle-icon")) return;
    const i = document.createElement("button");
    i.id = "llmfo-toggle-icon";
    i.type = "button";
    i.title = "Overlay einblenden (Code)";
    i.setAttribute("aria-label", "Overlay einblenden (Code)");
    Object.assign(i.style, {
      position:"fixed", top:"10px", right:"10px", width:"16px", height:"16px",
      borderRadius:"50%", border:"none", background:"#ef4444", padding:"0",
      cursor:"pointer", zIndex:"2147483647", boxShadow:"0 0 0 3px #fff, 0 2px 8px rgba(0,0,0,.35)"
    });
    i.addEventListener("click", verifyUnlockAndShow);
    document.body.appendChild(i);
  }
  function removeToggleIcon(){ const i=document.getElementById("llmfo-toggle-icon"); if(i) i.remove(); }
  function hideOverlay(){ localStorage.setItem(HIDDEN_KEY,"1"); const el=document.getElementById("llm-footprint-overlay"); if(el) el.remove(); createToggleIcon(); }
  function showOverlay(){ localStorage.removeItem(HIDDEN_KEY); removeToggleIcon(); createBadge(); }
  function isHidden(){ return localStorage.getItem(HIDDEN_KEY) === "1"; }
  function verifyUnlockAndShow(){ const input=prompt("Bitte Code eingeben:"); if(input===null) return; if(String(input).trim()===UNLOCK_CODE) showOverlay(); else alert("Falscher Code."); }

  // --- Tabs / Panels ---
  function setActiveTab(which){
    const visBtn=document.getElementById("llmfo-vis");
    const dataBtn=document.getElementById("llmfo-data");
    if (visBtn && dataBtn){ visBtn.classList.toggle("is-active", which==="visual"); dataBtn.classList.toggle("is-active", which==="data"); }
  }
  function showPanel(which){
    const vis=document.getElementById("llmfo-visual");
    const data=document.getElementById("llmfo-data-panel");
    if(!vis||!data) return;
    if(which==="visual"){ vis.classList.remove("hidden"); data.classList.add("hidden"); setActiveTab("visual"); updateVisualization(); }
    else { data.classList.remove("hidden"); vis.classList.add("hidden"); setActiveTab("data"); renderDataPanel(); }
  }

  function createBadge(){
    if (document.getElementById("llm-footprint-overlay")) return;
    injectStylesOnce();

    const el=document.createElement("div");
    el.id="llm-footprint-overlay";
    el.innerHTML = `
      <div class="llmfo-row llmfo-toprow" style="display:flex;align-items:center;gap:8px;">
        <span class="llmfo-dot llmfo-green"></span>
        <strong style="font-size:14px;">ChatGPT Footprint</strong>
        <span style="flex:1;"></span>
        <button id="llmfo-hide" title="Ausblenden" aria-label="Ausblenden"
          style="width:28px;height:28px;border:none;border-radius:50%;color:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;">×</button>
      </div>

      <!-- Toolbar -->
      <div class="llmfo-toolbar">
        <div class="llmfo-toolbar-row">
          <span id="llmfo-unc" class="llmfo-pill">Bandbreite: ±${UNCERTAINTY_PCT}%</span>
        </div>
        <div class="llmfo-toolbar-row llmfo-actions">
          <button id="llmfo-vis"  class="llmfo-pill is-active" type="button">Visualisierung</button>
          <button id="llmfo-data" class="llmfo-pill" type="button">Daten</button>
          <button id="llmfo-daily-export" class="llmfo-pill" type="button">Export</button>
          <button id="llmfo-help" class="llmfo-pill" type="button">Info</button>
        </div>
      </div>

      <!-- Visualisierung -->
      <div id="llmfo-visual" class="llmfo-visual">
        <div class="llmfo-visual-head" style="display:flex;justify-content:space-between;align-items:center;">
          <div class="llmfo-visual-title">
            <strong style="font-size:14px;">Visualisierung</strong>
            <span class="llmfo-visual-sub">Dein Energie-Fussabdruck</span>
          </div>
          <div class="llmfo-visual-controls">
            <select id="llmfo-scope" class="llmfo-chip">
              <option value="day">Heute</option>
              <option value="total">Insgesamt</option>
              <option value="last">Letzte Antwort</option>
            </select>
          </div>
        </div>
        <div class="llmfo-visual-body">
          <!-- Wasser -->
          <div class="llmfo-card">
            <div class="llmfo-flex">
              <img alt="Water" src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4a7.png">
              <div class="llmfo-col">
                <div class="llmfo-subtext">Wasser Shots <span class="llmfo-cap">(40 mL)</span></div>
                <div class="llmfo-bignum" id="llmfo-water-shots">–</div>
                <div class="llmfo-value" id="llmfo-water-ml">0,00 mL</div>
              </div>
            </div>
          </div>
          <!-- Energie (Smartphones) – farbiger Wh-Wert -->
          <div class="llmfo-card">
            <div class="llmfo-flex">
              <img alt="Energy" src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f50b.png">
              <div class="llmfo-col">
                <div class="llmfo-subtext">Smartphones</div>
                <div class="llmfo-bignum" id="llmfo-phone">–</div>
                <div class="llmfo-value"><span id="llmfo-wh" class="llmfo-colored-wh">– Wh</span></div>
              </div>
            </div>
          </div>
          <!-- CO₂ – farbiger gCO2e-Wert -->
          <div class="llmfo-card">
            <div class="llmfo-flex">
              <img alt="CO2" src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f697.png">
              <div class="llmfo-col">
                <div class="llmfo-subtext">Meter Fahrt</div>
                <div class="llmfo-bignum" id="llmfo-car-m">–</div>
                <div class="llmfo-value"><span id="llmfo-g" class="llmfo-colored-g">– gCO₂e</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Daten-Panel (nur Zusammenfassung) -->
      <div id="llmfo-data-panel" class="llmfo-data hidden">
        <div class="llmfo-visual-head" style="display:flex;flex-direction:column;gap:6px;margin:6px 0;">
          <div class="llmfo-visual-title">
            <strong style="font-size:14px;">Daten</strong>
            <span class="llmfo-visual-sub">Zusammenfassung</span>
          </div>
          <div class="llmfo-row llmfo-small" id="llmfo-last">Letzte: –</div>
          <div class="llmfo-row llmfo-small" id="llmfo-day">Heute: –</div>
          <div class="llmfo-row llmfo-small" id="llmfo-week">Insgesamt: –</div>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    // Actions
    document.getElementById("llmfo-help").addEventListener("click", e => {
      e.preventDefault();
      alert(`Berechnung (GPT-4o):
• Kurz: 0.421 Wh · Mittel: 1.214 Wh · Lang: 1.788 Wh
• CO₂ = (Wh/1000) × ${EU_CIF_G_PER_KWH} g
• Wasser = (Wh/1000) × ${EU_WUE_L_PER_KWH} L
Bandbreite: ±${UNCERTAINTY_PCT}%`);
    });
    document.getElementById("llmfo-daily-export").addEventListener("click", e => { e.preventDefault(); exportDailyCSV(); });
    document.getElementById("llmfo-hide").addEventListener("click", hideOverlay);
    document.getElementById("llmfo-vis").addEventListener("click", e => { e.preventDefault(); showPanel("visual"); });
    document.getElementById("llmfo-data").addEventListener("click", e => { e.preventDefault(); showPanel("data"); });

    const scopeSelect = document.getElementById("llmfo-scope");
    if (scopeSelect) scopeSelect.addEventListener("change", () => {
      const vis = document.getElementById("llmfo-visual");
      if (vis && !vis.classList.contains("hidden")) updateVisualization();
    });
    updateVisualization(); // default
  }

  // ===== Daten-Panel (nur Summary) =====
  function renderDataPanel(){
    const lastEl = document.getElementById("llmfo-last");
    if (lastEl) {
      const ml = (lastEst.l || 0) * 1000;
      const mlStr = ml >= 1 ? `${Math.round(ml)} mL` : (ml >= 0.1 ? `${ml.toFixed(1)} mL` : (ml > 0 ? "<0.1 mL" : "0 mL"));
      lastEl.textContent = `Letzte: ${mlStr} • ${format(lastEst.wh || 0, 2)} Wh • ${format(lastEst.g || 0, 2)} gCO₂e`;
    }
    updateAggLabels();
  }

  // ===== UI-Labels (für Daten-Tab) =====
  function updateAggLabels(){
    const day   = getAgg(dayKey());
    const total = getAgg(TOTAL_KEY);
    const dayEl   = document.getElementById("llmfo-day");
    const totalEl = document.getElementById("llmfo-week");
    const dayML   = formatMLfromL(day.l || 0);
    const totalML = formatMLfromL(total.l || 0);
    const dayWH   = format(day.wh || 0, 3);
    const totalWH = format(total.wh || 0, 3);
    const dayG    = format(day.g || 0, 1);
    const totalG  = format(total.g || 0, 1);
    const dayN    = day.n || 0;
    const totalN  = total.n || 0;
    if (dayEl)   dayEl.textContent   = `Heute: ${dayML} • ${dayWH} Wh • ${dayG} gCO₂e • ${dayN} Prompts`;
    if (totalEl) totalEl.textContent = `Insgesamt: ${totalML} • ${totalWH} Wh • ${totalG} gCO₂e • ${totalN} Prompts`;
  }

  // ===== Visualisierung =====
  function updateVisualization(){
    const scopeSelect = document.getElementById("llmfo-scope");
    const scope = (scopeSelect && scopeSelect.value) || "day";
    let v;
    if (scope === "last") v = lastEst;
    else if (scope === "day") v = getAgg(dayKey());
    else if (scope === "total") v = getAgg(TOTAL_KEY);
    else v = { wh:0, g:0, l:0 };

    const l = v.l || 0, wh = v.wh || 0, g = v.g || 0;
    const shots  = l / SHOT_LITERS;
    const phones = wh / SMARTPHONE_WH;
    const meters = (g / CAR_G_PER_KM) * 1000;

    const elWaterShots = document.getElementById("llmfo-water-shots");
    const elWaterML    = document.getElementById("llmfo-water-ml");
    const elPhone      = document.getElementById("llmfo-phone");
    const elWh         = document.getElementById("llmfo-wh");   // farbig (Wh)
    const elCarM       = document.getElementById("llmfo-car-m");
    const elG          = document.getElementById("llmfo-g");    // farbig (gCO2e)

    // Wasser
    if (elWaterShots) elWaterShots.textContent = `${format(shots, 2)}`;
    if (elWaterML)    elWaterML.textContent    = `${formatLocale(l * 1000, 2)} mL`;

    // Energie (Smartphones): farbiges "XY Wh"
    if (elPhone) elPhone.textContent = format(phones, 1);
    if (elWh)    elWh.textContent    = `${format(wh, 2)} Wh`;

    // CO₂ (Auto): farbiges "XY gCO₂e"
    if (elCarM) elCarM.textContent = format(meters, 0);
    if (elG)    elG.textContent    = `${format(g, 1)} gCO₂e`;
  }

  function getLastText(role){ const nodes=document.querySelectorAll(`[data-message-author-role="${role}"]`); return nodes.length ? nodes[nodes.length-1].innerText || "" : ""; }
  function setDot(className){ const dot=document.querySelector(".llmfo-dot"); if(dot) dot.className = `llmfo-dot ${className}`; }

  // ===== Prozess & Observer =====
  const QUIET_MS = 1200;
  let updateTimer = null;
  const processedIds = new Set();
  let lastEst = { wh:0, g:0, l:0 };

  function hashText(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(16); }
  function getLastNode(role){ const nodes=document.querySelectorAll(`[data-message-author-role="${role}"]`); return nodes.length ? nodes[nodes.length-1] : null; }

  function processOnceWhenQuiet(){
    const inText=getLastText("user");
    const outNode=getLastNode("assistant");
    const outText=outNode ? (outNode.innerText || "") : "";
    if(!inText.trim() || !outText.trim()) return;

    const msgIdAttr=outNode?.getAttribute("data-message-id");
    const msgId = msgIdAttr ? `id:${msgIdAttr}` : `h:${hashText(outText)}`;
    if (processedIds.has(msgId)) return;

    const inEst=estimateFromIO(inText.length, 0);
    const outEst=estimateFromIO(0, outText.length);
    const est={ wh:inEst.wh+outEst.wh, g:inEst.g+outEst.g, l:inEst.l+outEst.l, klass:`${inEst.klass}+${outEst.klass}` };
    lastEst = est;

    setDot(est.g < 1 ? "llmfo-green" : est.g < 5 ? "llmfo-yellow" : "llmfo-red");

    const ptKey=promptTimeKeyForText(inText);
    const ptIso=localStorage.getItem(ptKey);
    const promptDate=ptIso ? new Date(ptIso) : new Date();
    const promptTimeStr=formatLocalHHMMSS(new Date(promptDate));
    try{ if(ptIso) localStorage.removeItem(ptKey); }catch{}

    const dk=dayKey(promptDate), wk=weekKey(promptDate), tk=TOTAL_KEY;

    const dAgg=getAgg(dk);
    const wAgg=getAgg(wk);
    const tAgg=getAgg(tk);

    ["wh","g","l"].forEach(k=>{ dAgg[k]=add(dAgg[k], est[k]); wAgg[k]=add(wAgg[k], est[k]); tAgg[k]=add(tAgg[k], est[k]); });
    dAgg.n=add(dAgg.n,1); wAgg.n=add(wAgg.n,1); tAgg.n=add(tAgg.n,1);

    if (!Array.isArray(dAgg.times)) dAgg.times=[];
    dAgg.times.push(promptTimeStr);

    setAgg(dk,dAgg); setAgg(wk,wAgg); setAgg(tk,tAgg);

    const visPanel=document.getElementById("llmfo-visual");
    if (visPanel && !visPanel.classList.contains("hidden")) updateVisualization();
    const dataPanel=document.getElementById("llmfo-data-panel");
    if (dataPanel && !dataPanel.classList.contains("hidden")) renderDataPanel();

    saveDailyDataToCSVLog(); saveWeeklyDataToCSVLog(); saveTotalDataToCSVLog();
    processedIds.add(msgId);
  }

  const obs=new MutationObserver(()=>{ rememberPromptTimeIfNew(); if(updateTimer) clearTimeout(updateTimer); updateTimer=setTimeout(processOnceWhenQuiet, QUIET_MS); });

  // --- CSV: Woche ---
  function saveWeeklyDataToCSVLog(){
    const logKey="llmfo_csvdata_week";
    const weekKeyStr=weekKey();
    const weekLabel=weekKeyStr.replace("llmfo_week_","KW_");
    const weekData=getAgg(weekKeyStr);
    if (!weekData || Number(weekData.n || 0)===0) return;
    let csvLog=JSON.parse(localStorage.getItem(logKey) || "[]");
    const newRow={ week:weekLabel, wh:Number(Number(weekData.wh).toFixed(4)), g:Number(Number(weekData.g).toFixed(2)), l:Number(Number(weekData.l).toFixed(4)), n:Number(weekData.n||0) };
    const idx=csvLog.findIndex(e=>e.week===weekLabel);
    if (idx!==-1) csvLog[idx]=newRow; else csvLog.push(newRow);
    localStorage.setItem(logKey, JSON.stringify(csvLog));
  }

  // --- CSV: Total ---
  function saveTotalDataToCSVLog(){
    const logKey="llmfo_csvdata_total";
    const totalData=getAgg(TOTAL_KEY);
    if (!totalData || Number(totalData.n || 0)===0) return;
    const newRow={ label:"TOTAL", wh:Number(Number(totalData.wh).toFixed(4)), g:Number(Number(totalData.g).toFixed(2)), l:Number(Number(totalData.l).toFixed(4)), n:Number(totalData.n||0) };
    let csvLog=JSON.parse(localStorage.getItem(logKey) || "[]");
    if (csvLog.length) csvLog[0]=newRow; else csvLog.push(newRow);
    localStorage.setItem(logKey, JSON.stringify(csvLog));
  }

  // --- Tageswechsel-Checkpoint ---
  function maybeSaveTotalCSVData(){
    const today=dayKey(), week=weekKey();
    let an_tag=localStorage.getItem("llmfo_csvdata_last_saved_day");
    let the_week=localStorage.getItem("llmfo_csvdata_last_saved_week");
    if (an_tag!==today){ saveDailyDataToCSVLog(); saveTotalDataToCSVLog(); localStorage.setItem("llmfo_csvdata_last_saved_day", today); }
    if (the_week!==week){ saveWeeklyDataToCSVLog(); localStorage.setItem("llmfo_csvdata_last_saved_week", week); }
  }

  // --- CSV Export: Tage ---
  function exportDailyCSV(){
    const firstYMD=localStorage.getItem("llmfo_csv_first_day") || toYMD(new Date());
    const lastYMD =toYMD(new Date());
    const rows=[["Datum","Wh","gCO₂e","Liter Wasser","Prompts","Zeiten"]];
    for(let d=fromYMD(firstYMD); toYMD(d)<=lastYMD; d=addDays(d,1)){
      const ymd=toYMD(d), agg=getAgg(`llmfo_day_${ymd}`);
      const wh=Number(Number(agg.wh||0).toFixed(4));
      const g =Number(Number(agg.g ||0).toFixed(2));
      const l =Number(Number(agg.l ||0).toFixed(4));
      const n =Number(agg.n ||0);
      const times=Array.isArray(agg.times)?agg.times.slice().sort():[];
      rows.push([ csvDateLabel(ymd), wh.toString().replace(".",","), g.toString().replace(".",","), l.toString().replace(".",","), n, times.join(" | ") ]);
    }
    const csv=rows.map(r=>r.join(";")).join("\r\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="llm_tages_footprint.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  // --- CSV Tageslog (intern) ---
  function saveDailyDataToCSVLog(){
    const logKey="llmfo_csvdata_day";
    const todayKey=dayKey();
    const dayData=getAgg(todayKey);
    if(!dayData || Number(dayData.n||0)===0) return;
    let csvLog=JSON.parse(localStorage.getItem(logKey) || "[]");
    const newRow={ date:todayKey.replace("llmfo_day_",""), wh:Number(Number(dayData.wh).toFixed(4)), g:Number(Number(dayData.g).toFixed(2)), l:Number(Number(dayData.l).toFixed(4)), n:Number(dayData.n||0), times:Array.isArray(dayData.times)?dayData.times.slice():[] };
    const idx=csvLog.findIndex(e=>e.date===newRow.date);
    if(idx!==-1) csvLog[idx]=newRow; else csvLog.push(newRow);
    localStorage.setItem(logKey, JSON.stringify(csvLog));
  }

  // ===== Boot =====
  function onReady(fn){ if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once:true }); else fn(); }
  function applyVisibilityFromStorage(){ isHidden()?createToggleIcon():(removeToggleIcon(), createBadge()); }

  ensureFirstDaySet();
  migrateWeekToTotalOnce();
  maybeSaveTotalCSVData();

  onReady(()=>{
    applyVisibilityFromStorage();
    const root=document.documentElement;
    obs.observe(root,{ subtree:true, childList:true });
    window.addEventListener("visibilitychange",()=>{ if(document.visibilityState!=="visible"){ saveDailyDataToCSVLog(); saveWeeklyDataToCSVLog(); saveTotalDataToCSVLog(); }});
    window.addEventListener("beforeunload",()=>{ saveDailyDataToCSVLog(); saveWeeklyDataToCSVLog(); saveTotalDataToCSVLog(); });
  });
})();
