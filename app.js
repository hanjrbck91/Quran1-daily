// ==== CONFIG ====
// Paste your deployed Google Apps Script Web App URL here after deployment.
// See apps-script/Code.gs and README.md for deployment steps.
const SHEET_ENDPOINT = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";

const TOTAL_PAGES = 604;
const LS_KEYS = {
  deviceId: "qd_device_id",
  completed: "qd_completed_pages",   // array of page numbers fully completed at least once
  history: "qd_history",             // array of {ts, date, page, seconds, source}
  currentPage: "qd_current_page"
};

// ==== DEVICE ID ====
function getDeviceId(){
  let id = localStorage.getItem(LS_KEYS.deviceId);
  if(!id){
    id = "dev_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(LS_KEYS.deviceId, id);
  }
  return id;
}

// ==== LOCAL DATA HELPERS ====
function getCompleted(){
  try{ return JSON.parse(localStorage.getItem(LS_KEYS.completed)) || []; }catch(e){ return []; }
}
function saveCompleted(arr){
  localStorage.setItem(LS_KEYS.completed, JSON.stringify(arr));
}
function getHistory(){
  try{ return JSON.parse(localStorage.getItem(LS_KEYS.history)) || []; }catch(e){ return []; }
}
function saveHistory(arr){
  localStorage.setItem(LS_KEYS.history, JSON.stringify(arr));
}

// ==== RANDOM PAGE SELECTION ====
function pickRandomPage(){
  const completed = getCompleted();
  let pool = [];
  for(let p = 1; p <= TOTAL_PAGES; p++){
    if(!completed.includes(p)) pool.push(p);
  }
  if(pool.length === 0){
    // all pages completed at least once -> reset pool, allow full random again
    pool = Array.from({length: TOTAL_PAGES}, (_, i) => i + 1);
  }
  const last = Number(localStorage.getItem(LS_KEYS.currentPage) || 0);
  if(pool.length > 1){
    pool = pool.filter(p => p !== last);
  }
  const page = pool[Math.floor(Math.random() * pool.length)];
  localStorage.setItem(LS_KEYS.currentPage, String(page));
  return page;
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

// ==== SUBMIT COMPLETION ====
function humanDuration(seconds){
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if(m === 0) return `${s} sec`;
  return `${m} min ${s} sec`;
}

async function logToSheet(entry){
  if(!SHEET_ENDPOINT || SHEET_ENDPOINT.indexOf("PASTE_") === 0){
    console.warn("Sheet endpoint not configured yet; skipping remote log.");
    return;
  }
  try{
    await fetch(SHEET_ENDPOINT, {
      method: "POST",
      mode: "no-cors", // Apps Script web apps don't return CORS headers by default; fire-and-forget
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(entry)
    });
  }catch(e){
    console.warn("Sheet log failed (offline?)", e);
  }
}

let currentSource = "digital";

async function handleComplete(){
  const elapsedMs = stopTimer();
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  const pageNumber = Number(localStorage.getItem(LS_KEYS.currentPage));
  const now = new Date();

  const entry = {
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    deviceId: getDeviceId(),
    page: pageNumber,
    durationSeconds: seconds,
    source: currentSource,
    imageFilename: currentImageFilename || ""
  };

  const history = getHistory();
  history.push(entry);
  saveHistory(history);

  const completed = getCompleted();
  if(!completed.includes(pageNumber)){
    completed.push(pageNumber);
    saveCompleted(completed);
  }

  logToSheet(entry);

  const feedback = document.getElementById("feedback");
  feedback.hidden = false;
  feedback.textContent = `Page ${pageNumber} complete — ${humanDuration(seconds)}. May Allah accept it.`;

  document.getElementById("completeBtn").hidden = true;
  document.getElementById("startBtn").hidden = false;
  document.getElementById("startBtn").textContent = "Start Next Time";
  document.getElementById("timerDisplay").textContent = "00:00";

  resetPhysicalCapture();
}

// ==== PHYSICAL CAPTURE ====
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

// ==== PROGRESS ====
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

function computeProgress(){
  const history = getHistory();
  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  let weekPages = 0, weekSeconds = 0, monthPages = 0, monthSeconds = 0;
  const daySet = new Set();

  history.forEach(h => {
    const t = new Date(h.timestamp);
    daySet.add(h.date);
    if(t >= weekStart){ weekPages++; weekSeconds += h.durationSeconds; }
    if(t >= monthStart){ monthPages++; monthSeconds += h.durationSeconds; }
  });

  return {
    weekPages,
    weekMinutes: Math.round(weekSeconds / 60),
    monthPages,
    monthMinutes: Math.round(monthSeconds / 60),
    totalPages: history.length,
    daysReturned: daySet.size,
    daySet
  };
}

function renderProgress(){
  const p = computeProgress();
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

async function loadTodayPage(){
  const pageNumber = pickRandomPage();
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
  startTimer();
});

document.getElementById("completeBtn").addEventListener("click", handleComplete);

document.getElementById("progressBtn").addEventListener("click", () => {
  renderProgress();
  document.getElementById("progressOverlay").hidden = false;
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

loadTodayPage();
