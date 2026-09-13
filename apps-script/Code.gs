/**
 * Quran 1/Daily - backend logger + per-device history API.
 * Deploy under hadhilnjrbrototype@gmail.com.
 * Bind this script to a Google Sheet (Extensions > Apps Script from the Sheet).
 * See ../README.md for full deploy steps.
 *
 * Endpoints (same /exec URL):
 *   POST body: {timestamp,date,deviceId,page,durationSeconds,source,imageFilename}
 *              -> appends a row, returns {ok:true}
 *   GET  ?deviceId=XYZ
 *              -> returns {ok:true, entries:[...]} containing ONLY that device's rows
 *   GET  (no deviceId)
 *              -> returns {ok:true, message:"..."} health check
 */

const SHEET_NAME = "Readings";
const HEADERS = [
  "timestamp",
  "date",
  "deviceId",
  "page",
  "durationSeconds",
  "source",
  "imageFilename"
];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body.deviceId || !body.page) {
      return jsonOutput_({ ok: false, error: "missing deviceId or page" });
    }
    const sheet = getSheet_();
    sheet.appendRow([
      body.timestamp || new Date().toISOString(),
      body.date || "",
      body.deviceId,
      body.page,
      body.durationSeconds || 0,
      body.source || "digital",
      body.imageFilename || ""
    ]);
    return jsonOutput_({ ok: true });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  const deviceId = e && e.parameter && e.parameter.deviceId;
  if (!deviceId) {
    return jsonOutput_({ ok: true, message: "Quran 1/Daily backend is running." });
  }
  try {
    const sheet = getSheet_();
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const idIdx = headers.indexOf("deviceId");
    const entries = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (String(row[idIdx]) === String(deviceId)) {
        const entry = {};
        headers.forEach((h, idx) => {
          entry[h] = row[idx];
        });
        entries.push(entry);
      }
    }
    return jsonOutput_({ ok: true, entries: entries });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}
