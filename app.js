// ==== CONFIG ====
const SHEET_ENDPOINT = "https://script.google.com/macros/s/AKfycbwoWvbD00mxX8Z1110Fnw7Rp6IxKxMQ9Ww9ZMShXGPqVRHEC_XsWxjPTiMCYd_rPwTjYA/exec";

const TOTAL_PAGES = 604;
const LS_DEVICE_KEY = "qd_device_id"; // only harmless device identifier lives locally

// ==== VIEWPORT HEIGHT ====
// iOS Safari resolves CSS height:100% (and even 100dvh, mid-toolbar-animation)
// against the layout viewport, which is taller than what you can actually see
// while the toolbars are up. That pushed the top of the reading screen off
// screen with no way to scroll back to it. visualViewport.height is the real
// visible height, so the app canvas is sized from that.
function setAppHeight(){
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  document.documentElement.style.setProperty("--app-h", h + "px");
}
setAppHeight();
window.addEventListener("resize", setAppHeight);
window.addEventListener("orientationchange", setAppHeight);
if(window.visualViewport){
  window.visualViewport.addEventListener("resize", setAppHeight);
  window.visualViewport.addEventListener("scroll", setAppHeight);
}

// ==== DEVICE ID (local, anonymous only) ====
function getDeviceId(){
  let id = localStorage.getItem(LS_DEVICE_KEY);
  if(!id){
    id = "dev_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(LS_DEVICE_KEY, id);
  }
  return id;
}

// ==== BACKEND: SAVE A READING ====
async function saveToSheet(entry){
  if(!SHEET_ENDPOINT || SHEET_ENDPOINT.indexOf("PASTE_") === 0){
    return { ok: false, error: "not_configured" };
  }
  try{
    const res = await fetch(SHEET_ENDPOINT, {
      method: "POST",
      // text/plain avoids a CORS preflight; Apps Script web apps allow
      // the response to be read back for this "simple request" shape.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(entry)
    });
    const json = await res.json();
    return json;
  }catch(e){
    console.warn("Sheet save failed", e);
    return { ok: false, error: String(e) };
  }
}

// ==== BACKEND: FETCH THIS DEVICE'S HISTORY ====
async function fetchHistoryFromBackend(deviceId){
  if(!SHEET_ENDPOINT || SHEET_ENDPOINT.indexOf("PASTE_") === 0){
    return { ok: false, entries: [] };
  }
  try{
    const url = SHEET_ENDPOINT + "?deviceId=" + encodeURIComponent(deviceId);
    const res = await fetch(url);
    const json = await res.json();
    if(json && json.ok && Array.isArray(json.entries)){
      return { ok: true, entries: json.entries };
    }
    return { ok: false, entries: [] };
  }catch(e){
    console.warn("History fetch failed (offline?)", e);
    return { ok: false, entries: [] };
  }
}

// ==== DERIVED DATA FROM BACKEND ENTRIES ====
function getCompletedPages(entries){
  return [...new Set(entries.map(e => Number(e.page)).filter(n => !isNaN(n)))];
}

function dayKey(timestamp){
  const d = new Date(timestamp);
  return d.toISOString().slice(0, 10);
}

// ==== RANDOM PAGE SELECTION (excludes pages this device already completed) ====
function pickRandomPage(completedPages){
  let pool = [];
  for(let p = 1; p <= TOTAL_PAGES; p++){
    if(!completedPages.includes(p)) pool.push(p);
  }
  if(pool.length === 0){
    // all 604 pages completed at least once -> allow full random again
    pool = Array.from({length: TOTAL_PAGES}, (_, i) => i + 1);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ==== QURAN FETCH (Al Quran Cloud API, Uthmani edition) ====
async function fetchPage(pageNumber){
  const res = await fetch(`https://api.alquran.cloud/v1/page/${pageNumber}/quran-uthmani`);
  if(!res.ok) throw new Error("Failed to load page " + pageNumber);
  const data = await res.json();
  return data.data; // { ayahs: [...], surahs: {...}, number, ... }
}

function toArabicDigits(n){
  return String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

function renderPage(pageData, pageNumber){
  const ayahs = pageData.ayahs;
  const surahNamesEn = [...new Set(ayahs.map(a => a.surah.englishName))];
  const surahNamesAr = [...new Set(ayahs.map(a => a.surah.name))];
  const juz = ayahs[0] && ayahs[0].juz;

  const arName = surahNamesAr.join(" · ");
  document.getElementById("pageTitle").textContent = `Page ${pageNumber} of ${TOTAL_PAGES}`;
  document.getElementById("pageSubtitle").textContent =
    surahNamesEn.map((en, i) => `Surah ${en}`).join(" · ") + (arName ? ` (${arName.replace(/سُورَةُ\s*/g, "")})` : "");
  document.getElementById("surahStrip").textContent = arName;
  document.getElementById("juzLabel").textContent = juz ? toArabicDigits(juz) : "";
  document.getElementById("pageStripNum").textContent = toArabicDigits(pageNumber);
  document.getElementById("pageFolio").textContent = toArabicDigits(pageNumber);

  document.getElementById("quranText").innerHTML = ayahs.map(a => {
    return `${a.text} <span class="ayah-num">﴿${toArabicDigits(a.numberInSurah)}﴾</span>`;
  }).join(" ");
}

// ==== PAGE FIT ====
// The whole Quran page must be visible at once, with no scrolling. Pages vary
// a lot in density, so we binary-search the largest font size that still fits
// the available box. If even the smallest readable size overflows (very dense
// pages on short viewports), we scale the text block proportionally as a last
// resort — it stays real, selectable, pinch-zoomable text either way.
const FIT_MAX_FONT = 30;
const FIT_MIN_FONT = 13;

function fitQuranPage(){
  const frame = document.getElementById("quranFrame");
  const textEl = document.getElementById("quranText");
  if(!frame || !textEl || !textEl.textContent.trim()) return;

  const frameStyle = getComputedStyle(frame);
  const available = frame.clientHeight
    - parseFloat(frameStyle.paddingTop)
    - parseFloat(frameStyle.paddingBottom);
  if(available <= 0) return; // screen not visible yet — nothing to measure against

  textEl.style.transform = "none";

  let lo = FIT_MIN_FONT;
  let hi = FIT_MAX_FONT;
  let best = FIT_MIN_FONT;

  while(hi - lo > 0.5){
    const mid = (lo + hi) / 2;
    textEl.style.fontSize = mid + "px";
    if(textEl.scrollHeight <= available){
      best = mid;
      lo = mid;
    }else{
      hi = mid;
    }
  }

  textEl.style.fontSize = best + "px";

  if(textEl.scrollHeight > available){
    const scale = available / textEl.scrollHeight;
    textEl.style.transform = `scale(${scale})`;
  }
}

let fitFrameHandle = null;
// Runs immediately (reading clientHeight forces layout, which is what we want
// right after the screen is unhidden), then again once the frame settles and
// once more after the fade-in / late webfont swap, since either changes metrics.
function syncHeightAndFit(){
  setAppHeight();   // re-read the real visible height; it drifts as toolbars move
  fitQuranPage();
}

function scheduleFit(){
  syncHeightAndFit();
  if(fitFrameHandle) cancelAnimationFrame(fitFrameHandle);
  fitFrameHandle = requestAnimationFrame(() => {
    fitFrameHandle = null;
    syncHeightAndFit();
  });
  setTimeout(syncHeightAndFit, 320);
}

window.addEventListener("resize", scheduleFit);
window.addEventListener("orientationchange", scheduleFit);
if(window.visualViewport){
  window.visualViewport.addEventListener("resize", scheduleFit);
}
if(document.fonts && document.fonts.ready){
  document.fonts.ready.then(scheduleFit);
}

// ==== SCREEN SWITCHING ====
function showScreen(id){
  ["screenLanding", "screenReading", "screenCompletion"].forEach(s => {
    document.getElementById(s).hidden = (s !== id);
  });
}

// ==== TIMER (timestamp based) ====
let readingStartTs = null;
let timerInterval = null;

function formatElapsed(ms){
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function startTimer(){
  readingStartTs = Date.now();
  document.getElementById("startBtn").hidden = true;
  document.getElementById("completeBtn").hidden = false;
  document.getElementById("completeBtn").disabled = false;
  document.querySelector(".timer-bar").classList.add("running");
  document.getElementById("timerLabel").textContent = "Reading — tap ✓ when done";
  timerInterval = setInterval(() => {
    document.getElementById("timerDisplay").textContent = formatElapsed(Date.now() - readingStartTs);
  }, 250);
}

function stopTimer(){
  clearInterval(timerInterval);
  const elapsedMs = readingStartTs ? (Date.now() - readingStartTs) : 0;
  readingStartTs = null;
  return elapsedMs;
}

function resetReadingUI(){
  clearInterval(timerInterval);
  readingStartTs = null;
  document.getElementById("timerDisplay").textContent = "00:00";
  document.getElementById("startBtn").hidden = false;
  document.getElementById("startBtn").disabled = false;
  document.getElementById("completeBtn").hidden = true;
  document.getElementById("completeBtn").disabled = false;
  document.getElementById("readingError").hidden = true;
  document.querySelector(".timer-bar").classList.remove("running");
  document.getElementById("timerLabel").textContent = "Ready when you are";
  pendingEntry = null;
  resetSaveLater();
  resetPhysicalCapture();
}

// ==== SUBMIT COMPLETION (backend-confirmed) ====
function humanDuration(seconds){
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if(m === 0) return `${s} sec`;
  return `${m} min ${s} sec`;
}

let currentSource = "digital";
let pendingEntry = null; // set only if a save attempt failed, so the user can retry

async function handleComplete(){
  const completeBtn = document.getElementById("completeBtn");
  const errorEl = document.getElementById("readingError");

  let entry = pendingEntry;
  if(!entry){
    const elapsedMs = stopTimer();
    const seconds = Math.max(1, Math.round(elapsedMs / 1000));
    const now = new Date();
    entry = {
      timestamp: now.toISOString(),
      date: now.toISOString().slice(0, 10),
      deviceId: getDeviceId(),
      page: currentPageNumber,
      durationSeconds: seconds,
      source: currentSource,
      imageFilename: currentImageFilename || ""
    };
  }

  completeBtn.disabled = true;
  document.getElementById("resetBtn").disabled = true;
  document.getElementById("timerLabel").textContent = "Saving…";
  errorEl.hidden = true;

  const result = await saveToSheet(entry);

  if(!result.ok){
    pendingEntry = entry;
    completeBtn.disabled = false;
    document.getElementById("resetBtn").disabled = false;
    document.getElementById("timerLabel").textContent = "Tap ✓ to retry";
    errorEl.hidden = false;
    errorEl.textContent = result.error === "not_configured"
      ? "Backend not configured yet — your reading was not saved."
      : "Could not save to Google Sheets. Check your connection and tap Retry Save.";
    return;
  }

  pendingEntry = null;

  // The POST coming back ok is the backend confirming the save, so the
  // completion state can show straight away. Refreshing the cached history is
  // only for the Journey sheet, so it runs in the background rather than
  // making the user wait on a second round-trip.
  fetchHistoryFromBackend(getDeviceId()).then(({ entries }) => {
    cachedEntries = entries;
    updateReturningLine(entries);
  });

  document.getElementById("completionDuration").textContent = humanDuration(entry.durationSeconds);
  showScreen("screenCompletion");
}

// ==== PHYSICAL CAPTURE (image stays local, never sent to the Sheet) ====
let currentImageFilename = "";

function resetPhysicalCapture(){
  currentImageFilename = "";
  currentSource = "digital";
  document.getElementById("physicalOverlay").hidden = true;
  document.getElementById("physicalPreview").src = "";
  document.getElementById("physicalInput").value = "";
  document.getElementById("captureLabel").textContent = "Capture / Upload";
  document.querySelector('label[for="physicalInput"]').classList.remove("is-on");
}

// "Save for Later" is a placeholder in this iteration — it deliberately does
// not persist anything, so it says so rather than pretending to have saved.
let saveLaterTimeout = null;
function resetSaveLater(){
  clearTimeout(saveLaterTimeout);
  document.getElementById("saveLaterLabel").textContent = "Save for";
  document.getElementById("saveLaterSub").textContent = "Later";
  document.getElementById("saveLaterBtn").classList.remove("is-on");
}

document.getElementById("physicalInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if(!file) return;
  currentImageFilename = file.name || "captured.jpg";
  currentSource = "physical";
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById("physicalPreview").src = ev.target.result;
    document.getElementById("physicalOverlay").hidden = false;
    document.getElementById("captureLabel").textContent = "Photo attached";
    document.querySelector('label[for="physicalInput"]').classList.add("is-on");
  };
  reader.readAsDataURL(file);
});

document.getElementById("closePhysical").addEventListener("click", () => {
  document.getElementById("physicalOverlay").hidden = true;
});

document.getElementById("clearPhysical").addEventListener("click", resetPhysicalCapture);

// ==== PROGRESS (computed from backend entries, never localStorage) ====
let cachedEntries = [];

function startOfWeek(d){
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun
  date.setHours(0,0,0,0);
  date.setDate(date.getDate() - day);
  return date;
}
function startOfMonth(d){
  const date = new Date(d);
  date.setHours(0,0,0,0);
  date.setDate(1);
  return date;
}

function computeProgress(entries){
  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  let weekPages = 0, weekSeconds = 0, monthPages = 0, monthSeconds = 0;
  const daySet = new Set();

  entries.forEach(h => {
    const t = new Date(h.timestamp);
    const seconds = Number(h.durationSeconds) || 0;
    daySet.add(dayKey(h.timestamp));
    if(t >= weekStart){ weekPages++; weekSeconds += seconds; }
    if(t >= monthStart){ monthPages++; monthSeconds += seconds; }
  });

  return {
    weekPages,
    weekMinutes: Math.round(weekSeconds / 60),
    monthPages,
    monthMinutes: Math.round(monthSeconds / 60),
    totalPages: entries.length,
    daysReturned: daySet.size,
    daySet
  };
}

function renderProgress(entries){
  const p = computeProgress(entries);
  document.getElementById("statWeekPages").textContent = p.weekPages;
  document.getElementById("statWeekMinutes").textContent = p.weekMinutes;
  document.getElementById("statMonthPages").textContent = p.monthPages;
  document.getElementById("statMonthMinutes").textContent = p.monthMinutes;
  document.getElementById("statTotalPages").textContent = p.totalPages;
  document.getElementById("statDaysReturned").textContent = p.daysReturned;

  const cal = document.getElementById("historyCalendar");
  cal.innerHTML = "";
  const days = 35; // 5 weeks
  const today = new Date();
  for(let i = days - 1; i >= 0; i--){
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const cell = document.createElement("div");
    cell.className = "history-day" + (p.daySet.has(key) ? " active" : "");
    cell.title = key;
    cal.appendChild(cell);
  }
}

function updateReturningLine(entries){
  const line = document.getElementById("returningLine");
  const daysReturned = computeProgress(entries).daysReturned;
  if(daysReturned === 0){
    line.hidden = true;
  }else{
    line.hidden = false;
    line.textContent = `This is day ${daysReturned + 1} of returning.`;
  }
  renderLandingTiles(entries);
}

// the four tiles on the landing screen, from the same backend entries
function renderLandingTiles(entries){
  const p = computeProgress(entries);
  document.getElementById("tileWeekPages").textContent = p.weekPages;
  document.getElementById("tileWeekMinutes").innerHTML = p.weekMinutes + "<small>min</small>";
  document.getElementById("tileMonthPages").textContent = p.monthPages;
  document.getElementById("tileTotalPages").textContent = p.totalPages;
}

function renderDateChip(){
  const now = new Date();
  const dow = now.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const mon = now.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  document.getElementById("dateDow").textContent = dow;
  document.getElementById("dateDay").textContent = now.getDate();
  document.getElementById("dateMon").textContent = `${mon} ${now.getFullYear()}`;
}
renderDateChip();

// ==== AI PROMPT ====
function buildAiPrompt(pageNumber, surahNames){
  return `I'm reading page ${pageNumber} of the Mushaf (Surah context: ${surahNames}). I'm attaching a photo/screenshot of this Quran page.

Please help me understand it by covering, in order:
1. Which surah and ayahs (verse range) are shown on this page.
2. The immediate context of this passage (what comes just before/after it).
3. What Allah is communicating in this passage — the core meaning.
4. Important deeper lessons and guidance from these ayahs.
5. Relevant historical / revelation (asbab al-nuzul) context, if known.
6. How this message applies to a Muslim living today, practically.
7. A few personal reflection questions for me to sit with.
8. A concise closing reflection.

Important: please clearly distinguish between the literal Quranic text/translation and your own or scholarly interpretation. Do not present AI-generated claims as religious authority — note where classical tafsir differs or where something is your own reading.`;
}

// ==== APP INIT / WIRING ====
let currentPageData = null;
let currentPageNumber = null;
let pageReadyPromise = null;

// Prefetches (in the background) this device's history + a random unread
// page, so tapping "Begin Today's Page" is instant. Does not touch the
// visible screen — the landing screen stays untouched until Begin is tapped.
async function prepareNextPage(){
  const deviceId = getDeviceId();

  const { entries } = await fetchHistoryFromBackend(deviceId);
  cachedEntries = entries;
  updateReturningLine(entries);

  const completedPages = getCompletedPages(entries);
  const pageNumber = pickRandomPage(completedPages);
  currentPageNumber = pageNumber;

  const data = await fetchPage(pageNumber);
  currentPageData = data;
}

function startPreparingNextPage(){
  pageReadyPromise = prepareNextPage().catch((e) => {
    console.error(e);
    throw e;
  });
}

document.getElementById("beginBtn").addEventListener("click", async () => {
  const beginBtn = document.getElementById("beginBtn");
  const landingError = document.getElementById("landingError");
  const originalLabel = beginBtn.textContent;

  if(!currentPageData){
    beginBtn.disabled = true;
    beginBtn.textContent = "Preparing…";
    landingError.hidden = true;
    try{
      await pageReadyPromise;
    }catch(e){
      beginBtn.disabled = false;
      beginBtn.textContent = originalLabel;
      landingError.hidden = false;
      startPreparingNextPage(); // allow retry on next tap
      return;
    }
    beginBtn.disabled = false;
    beginBtn.textContent = originalLabel;
  }

  renderPage(currentPageData, currentPageNumber);
  resetReadingUI();
  showScreen("screenReading");
  scheduleFit(); // must run after the screen is visible, or there's nothing to measure
});

document.getElementById("backBtn").addEventListener("click", () => {
  if(readingStartTs !== null){
    stopTimer();
  }
  showScreen("screenLanding");
});

document.getElementById("startBtn").addEventListener("click", () => {
  pendingEntry = null;
  startTimer();
});

document.getElementById("completeBtn").addEventListener("click", handleComplete);

// stop / reset: abandon the current timing without saving anything
document.getElementById("resetBtn").addEventListener("click", () => {
  if(readingStartTs === null && !pendingEntry) return;
  resetReadingUI();
});

document.getElementById("saveLaterBtn").addEventListener("click", () => {
  const btn = document.getElementById("saveLaterBtn");
  btn.classList.add("is-on");
  document.getElementById("saveLaterLabel").textContent = "Coming";
  document.getElementById("saveLaterSub").textContent = "soon";
  clearTimeout(saveLaterTimeout);
  saveLaterTimeout = setTimeout(resetSaveLater, 1800);
});

// bottom nav: Progress opens Your Journey, the rest are placeholders
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const which = tab.dataset.tab;
    if(which === "progress"){
      openJourney();
      return;
    }
    if(which === "home") return;
    tab.classList.add("is-pending");
    setTimeout(() => tab.classList.remove("is-pending"), 400);
  });
});

document.getElementById("seeAllBtn").addEventListener("click", () => openJourney());
document.getElementById("menuBtn").addEventListener("click", () => openJourney());

document.getElementById("doneBtn").addEventListener("click", () => {
  resetReadingUI();
  currentPageData = null;
  currentPageNumber = null;
  startPreparingNextPage(); // get tomorrow's-visit page ready in the background
  showScreen("screenLanding");
});

async function openJourney(){
  document.getElementById("progressOverlay").hidden = false;
  renderProgress(cachedEntries); // show cached instantly
  const deviceId = getDeviceId();
  const { entries } = await fetchHistoryFromBackend(deviceId);
  cachedEntries = entries;
  renderProgress(entries); // then refresh with latest from the Sheet
}

document.getElementById("journeyBtn").addEventListener("click", openJourney);
document.getElementById("journeyBtnReading").addEventListener("click", openJourney);
document.getElementById("closeProgress").addEventListener("click", () => {
  document.getElementById("progressOverlay").hidden = true;
});

document.getElementById("aiPromptBtn").addEventListener("click", () => {
  const surahNames = currentPageData
    ? [...new Set(currentPageData.ayahs.map(a => a.surah.englishName))].join(", ")
    : "unknown";
  document.getElementById("aiPromptText").value = buildAiPrompt(currentPageNumber, surahNames);
  document.getElementById("copyConfirm").hidden = true;
  document.getElementById("aiPromptOverlay").hidden = false;
});
document.getElementById("closeAiPrompt").addEventListener("click", () => {
  document.getElementById("aiPromptOverlay").hidden = true;
});
document.getElementById("copyPromptBtn").addEventListener("click", async () => {
  const text = document.getElementById("aiPromptText").value;
  try{
    await navigator.clipboard.writeText(text);
  }catch(e){
    document.getElementById("aiPromptText").select();
    document.execCommand("copy");
  }
  document.getElementById("copyConfirm").hidden = false;
});

// PWA service worker
if("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

startPreparingNextPage();
