/**
 * Quran 1/Daily - backend logger.
 * Deploy under hadhilnjrbrototype@gmail.com.
 * Bind this script to a Google Sheet (Extensions > Apps Script from the Sheet).
 * See ../README.md for full deploy steps.
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

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const sheet = getSheet_();
    sheet.appendRow([
      body.timestamp || new Date().toISOString(),
      body.date || "",
      body.deviceId || "",
      body.page || "",
      body.durationSeconds || "",
      body.source || "digital",
      body.imageFilename || ""
    ]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: "Quran 1/Daily backend is running." }))
    .setMimeType(ContentService.MimeType.JSON);
}
