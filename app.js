// ==== CONFIG ====
// Paste your deployed Google Apps Script Web App URL here after deployment.
// See apps-script/Code.gs and README.md for deployment steps.
const SHEET_ENDPOINT = "https://script.google.com/macros/s/AKfycbwoWvbD00mxX8Z1110Fnw7Rp6IxKxMQ9Ww9ZMShXGPqVRHEC_XsWxjPTiMCYd_rPwTjYA/exec";

const TOTAL_PAGES = 604;
const LS_DEVICE_KEY = "qd_device_id"; // only harmless device identifier lives locally

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

function renderPage(pageData, pageNumber){
  const meta = document.getElementById("pageMeta");
  const textEl = document.getElementById("quranText");

  const surahNames = [...new Set(pageData.ayahs.map(a => a.surah.englishName + " (" + a.surah.name + ")"))];
  meta.textContent = `Page ${pageNumber} of ${TOTAL_PAGES} · ${surahNames.join(" · ")}`;

  textEl.innerHTML = pageData.ayahs.map(a => {
    return `${a.text} <span class="ayah-num">﴿${a.numberInSurah}﴾</span>`;
  }).join(" ");
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
  document.getElementById("completeBtn").textContent = "Page Complete";
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
  const feedback = document.getElementById("feedback");

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
  completeBtn.textContent = "Saving…";
  feedback.hidden = true;

  const result = await saveToSheet(entry);

  if(!result.ok){
    pendingEntry = entry;
    completeBtn.disabled = false;
    completeBtn.textContent = "Retry Save";
    feedback.hidden = false;
    feedback.textContent = result.error === "not_configured"
      ? "Backend not configured yet — set SHEET_ENDPOINT in app.js. Your reading was NOT saved."
      : "Could not save to Google Sheets. Check your connection and tap Retry Save.";
    return;
  }

  pendingEntry = null;

  feedback.hidden = false;
  feedback.textContent = `Page ${entry.page} complete — ${humanDuration(entry.durationSeconds)}. May Allah accept it.`;

  completeBtn.hidden = true;
  completeBtn.disabled = false;
  document.getElementById("startBtn").hidden = false;
  document.getElementById("startBtn").textContent = "Start Next Time";
  document.getElementById("timerDisplay").textContent = "00:00";

  resetPhysicalCapture();

  // Refresh cached history so Progress reflects this reading immediately.
  const deviceId = getDeviceId();
  const { entries } = await fetchHistoryFromBackend(deviceId);
  cachedEntries = entries;
}

// ==== PHYSICAL CAPTURE (image stays local, never sent to the Sheet) ====
let currentImageFilename = "";

function resetPhysicalCapture(){
  currentImageFilename = "";
  currentSource = "digital";
  document.getElementById("physicalPreviewWrap").hidden = true;
  document.getElementById("physicalPreview").src = "";
  document.getElementById("physicalInput").value = "";
}

document.getElementById("physicalInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if(!file) return;
  currentImageFilename = file.name || "captured.jpg";
  currentSource = "physical";
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById("physicalPreview").src = ev.target.result;
    document.getElementById("physicalPreviewWrap").hidden = false;
  };
  reader.readAsDataURL(file);
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

async function initApp(){
  const deviceId = getDeviceId();

  document.getElementById("pageMeta").textContent = "Loading your progress…";
  const { entries } = await fetchHistoryFromBackend(deviceId);
  cachedEntries = entries;

  const completedPages = getCompletedPages(entries);
  const pageNumber = pickRandomPage(completedPages);
  currentPageNumber = pageNumber;

  document.getElementById("pageMeta").textContent = "Loading page " + pageNumber + "…";
  try{
    const data = await fetchPage(pageNumber);
    currentPageData = data;
    renderPage(data, pageNumber);
  }catch(e){
    document.getElementById("pageMeta").textContent = "Could not load page. Check your connection and reload.";
    console.error(e);
  }
}

document.getElementById("startBtn").addEventListener("click", () => {
  document.getElementById("feedback").hidden = true;
  document.getElementById("startBtn").textContent = "Start Reading";
  pendingEntry = null;
  startTimer();
});

document.getElementById("completeBtn").addEventListener("click", handleComplete);

document.getElementById("progressBtn").addEventListener("click", async () => {
  document.getElementById("progressOverlay").hidden = false;
  renderProgress(cachedEntries); // show cached instantly
  const deviceId = getDeviceId();
  const { entries } = await fetchHistoryFromBackend(deviceId);
  cachedEntries = entries;
  renderProgress(entries); // then refresh with latest from the Sheet
});
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

initApp();
