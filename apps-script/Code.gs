/**
 * Google Apps Script สำหรับเก็บข้อมูลมิเตอร์การพิมพ์ลง Google Sheet
 * วิธีติดตั้งดูใน README.md
 */

const SHEET_NAME = 'บันทึกมิเตอร์';

// ต้องเรียงลำดับเหมือน MATERIALS ใน config.js
const FIELDS = [
  ['pp_matte__color', 'PP ด้าน - สี (แผ่น)'],
  ['pp_matte__bw', 'PP ด้าน - ขาวดำ (แผ่น)'],
  ['pp_gloss__color', 'PP เงา - สี (แผ่น)'],
  ['pp_gloss__bw', 'PP เงา - ขาวดำ (แผ่น)'],
  ['paper_gloss__color', 'กระดาษเงา - สี (แผ่น)'],
  ['paper_gloss__bw', 'กระดาษเงา - ขาวดำ (แผ่น)'],
  ['pp_clear__color', 'PP ใส - สี (แผ่น)'],
  ['pp_clear__bw', 'PP ใส - ขาวดำ (แผ่น)'],
  ['paper_art__color', 'กระดาษอาร์ต - สี (แผ่น)'],
  ['paper_art__bw', 'กระดาษอาร์ต - ขาวดำ (แผ่น)'],
];
const HEADER = ['Timestamp', 'พนักงาน'].concat(FIELDS.map(f => f[1]), ['รวม (แผ่น)', 'รายละเอียด', 'ID']);
const COL_ID = HEADER.length; // คอลัมน์สุดท้าย

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADER.length).setFontWeight('bold');
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const sh = getSheet_();
    const last = sh.getLastRow();
    if (last < 2) return json_({ ok: true, records: [] });
    const rows = sh.getRange(2, 1, last - 1, HEADER.length).getValues();
    const records = rows.filter(r => r[COL_ID - 1]).map(r => {
      const totals = {};
      FIELDS.forEach((f, i) => { totals[f[0]] = Number(r[2 + i]) || 0; });
      let details = {};
      try { details = JSON.parse(r[HEADER.length - 2] || '{}'); } catch (err) {}
      return {
        id: String(r[COL_ID - 1]),
        ts: new Date(r[0]).toISOString(),
        employee: String(r[1]),
        totals: totals,
        details: details,
      };
    });
    return json_({ ok: true, records: records });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents);
    const sh = getSheet_();

    if (body.action === 'add') {
      const r = body.record;
      if (findRow_(sh, r.id)) return json_({ ok: true, duplicate: true });
      const values = FIELDS.map(f => Number(r.totals[f[0]]) || 0);
      const total = values.reduce((a, b) => a + b, 0);
      sh.appendRow([new Date(r.ts), r.employee].concat(values, [total, JSON.stringify(r.details || {}), r.id]));
      return json_({ ok: true });
    }

    if (body.action === 'delete') {
      const row = findRow_(sh, body.id);
      if (row) sh.deleteRow(row);
      return json_({ ok: true });
    }

    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2 || !id) return 0;
  const ids = sh.getRange(2, COL_ID, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return 0;
}
