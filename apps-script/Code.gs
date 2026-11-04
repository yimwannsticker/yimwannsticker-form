/**
 * Google Apps Script สำหรับเก็บข้อมูลมิเตอร์การพิมพ์ลง Google Sheet
 * วิธีติดตั้งดูใน README.md
 */

const SHEET_NAME = 'บันทึกมิเตอร์';
const TRASH_NAME = 'ถังขยะ';

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
const COL_ID = HEADER.length; // คอลัมน์ ID (ตำแหน่งเดียวกันทั้งชีตหลักและถังขยะ)
const TRASH_HEADER = HEADER.concat(['ลบเมื่อ', 'ลบโดย']);

function getSheet_(name, header) {
  name = name || SHEET_NAME;
  header = header || HEADER;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return sh;
}

function readRows_(sh, width) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, width).getValues().filter(r => r[COL_ID - 1]);
}

function toRecord_(r) {
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
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.action === 'pack_list') return json_(packList_());
    if (e && e.parameter && e.parameter.action === 'sales_list') return json_(salesList_(e.parameter.force === '1'));
    const records = readRows_(getSheet_(), HEADER.length).map(toRecord_);
    const trash = readRows_(getSheet_(TRASH_NAME, TRASH_HEADER), TRASH_HEADER.length).map(r => {
      const rec = toRecord_(r);
      rec.deletedAt = new Date(r[HEADER.length]).toISOString();
      rec.deletedBy = String(r[HEADER.length + 1] || '');
      return rec;
    });
    return json_({ ok: true, records: records, trash: trash });
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

    // ไม่ลบทิ้งจริง: ย้ายแถวไปแท็บ "ถังขยะ" เพื่อกู้คืนได้
    if (body.action === 'trash') {
      const row = findRow_(sh, body.id);
      if (!row) return json_({ ok: true, missing: true });
      const values = sh.getRange(row, 1, 1, HEADER.length).getValues()[0];
      getSheet_(TRASH_NAME, TRASH_HEADER).appendRow(values.concat([new Date(), body.by || '']));
      sh.deleteRow(row);
      return json_({ ok: true });
    }

    if (body.action === 'restore') {
      const trash = getSheet_(TRASH_NAME, TRASH_HEADER);
      const row = findRow_(trash, body.id);
      if (!row) return json_({ ok: true, missing: true });
      const values = trash.getRange(row, 1, 1, HEADER.length).getValues()[0];
      if (!findRow_(sh, body.id)) {
        sh.appendRow(values);
        if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, HEADER.length).sort(1);
      }
      trash.deleteRow(row);
      return json_({ ok: true });
    }

    if (body.action === 'pack_upload') return json_(packUpload_(body));
    if (body.action === 'pack_done') return json_(packDone_(body));
    if (body.action === 'pack_undo') return json_(packUndo_(body));
    if (body.action === 'sales_upsert') return json_(salesUpsert_(body));
    if (body.action === 'sales_target') return json_(salesTarget_(body));
    if (body.action === 'sales_daily') return json_(salesDaily_(body));

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

// ================= เช็คก่อนแพ็ค =================
// แต่ละแถว = 1 กล่อง (1 เลขพัสดุ) อ่านมาจาก PDF ใบปะหน้าแบบมีรายละเอียดสินค้า

const PACK_NAME = 'เช็คแพ็ค';
const PACK_HEADER = ['เลขพัสดุ', 'Order ID', 'รายการ', 'จำนวนรวม (แผ่น)', 'อัปโหลดเมื่อ', 'อัปโหลดโดย',
  'แพ็คโดย', 'แพ็คเมื่อ', 'ข้อมูล (JSON)'];
const PACK_DAYS = 14; // ส่งรายการย้อนหลังกี่วันให้แอพ

function packSheet_() {
  return getSheet_(PACK_NAME, PACK_HEADER);
}

function packRows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, PACK_HEADER.length).getValues();
}

function packFind_(sh, tracking) {
  const last = sh.getLastRow();
  if (last < 2 || !tracking) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(tracking)) return i + 2;
  }
  return 0;
}

function packList_() {
  const since = Date.now() - PACK_DAYS * 864e5;
  const orders = [];
  packRows_(packSheet_()).forEach(r => {
    if (!r[0]) return;
    const uploaded = new Date(r[4]);
    if (uploaded.getTime() < since && r[6]) return;
    let items = [];
    try { items = JSON.parse(r[8] || '[]'); } catch (err) {}
    orders.push({
      tracking: String(r[0]),
      orderId: String(r[1]),
      qty: Number(r[3]) || 0,
      items: items,
      uploadedAt: uploaded.toISOString(),
      packedBy: String(r[6] || ''),
      packedAt: r[7] ? new Date(r[7]).toISOString() : '',
    });
  });
  return { ok: true, orders: orders };
}

function packUpload_(body) {
  const sh = packSheet_();
  let added = 0, skipped = 0;
  (body.orders || []).forEach(o => {
    if (!o.tracking) return;
    if (packFind_(sh, o.tracking)) { skipped++; return; }
    const items = (o.items || []).map(it => ({ code: it.code || '', sku: it.sku || '', sellerSku: it.sellerSku || '', name: it.name || '', qty: Number(it.qty) || 0 }));
    const text = items.map(it => (it.sellerSku || it.sku) + ' ×' + it.qty).join(' | ');
    const qty = items.reduce((a, b) => a + b.qty, 0);
    sh.appendRow([String(o.tracking), "'" + String(o.orderId || ''), text, qty, new Date(), body.by || '', '', '', JSON.stringify(items)]);
    added++;
  });
  return { ok: true, added: added, skipped: skipped };
}

function packDone_(body) {
  const sh = packSheet_();
  const row = packFind_(sh, body.tracking);
  if (!row) return { ok: false, error: 'ไม่พบเลขพัสดุนี้' };
  const cur = sh.getRange(row, 7, 1, 2).getValues()[0];
  if (cur[0]) return { ok: true, already: true, packedBy: String(cur[0]), packedAt: new Date(cur[1]).toISOString() };
  sh.getRange(row, 7, 1, 2).setValues([[body.by || '', new Date()]]);
  return { ok: true };
}

function packUndo_(body) {
  const sh = packSheet_();
  const row = packFind_(sh, body.tracking);
  if (!row) return { ok: true, missing: true };
  sh.getRange(row, 7, 1, 2).clearContent();
  return { ok: true };
}

// ================= ยอดขายรายเดือน =================
// เก็บเฉพาะยอดรวมของแต่ละเดือน (ไม่มีข้อมูลลูกค้า) 1 แถว = 1 เดือน

const SALES_NAME = 'ยอดขายรายเดือน';
// คอลัมน์ B–D = ยอดจาก Dashboard (ไฟล์ full_month ใน Drive, สรุปหลังวันที่ 15 เดือนถัดไป)
// คอลัมน์ H–K = ยอดรายวันที่แอดมินอัปเอง (Gross จากไฟล์ออเดอร์ Shopee/TikTok + ยอด Line ที่กรอก)
const SALES_HEADER = ['เดือน', 'ยอดขาย Dashboard (บาท)', 'ออเดอร์ Dashboard', 'Dashboard แยกช่องทาง (JSON)', 'เป้า (บาท)', 'อัปเดตเมื่อ', 'อัปเดตโดย',
  'ยอดรายวัน (บาท)', 'ออเดอร์รายวัน', 'รายวันแยกช่องทาง (JSON)', 'อัปรายวันเมื่อ'];

function salesSheet_() {
  const sh = getSheet_(SALES_NAME, SALES_HEADER);
  if (sh.getLastColumn() < SALES_HEADER.length) {
    sh.getRange(1, 1, 1, SALES_HEADER.length).setValues([SALES_HEADER]).setFontWeight('bold');
  }
  sh.getRange('A:A').setNumberFormat('@'); // เก็บ "2026-11" เป็นข้อความ ไม่ให้กลายเป็นวันที่
  return sh;
}

function salesFind_(sh, month) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const vals = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(month)) return i + 2;
  return 0;
}

function salesList_(force) {
  let sync = null;
  try { sync = salesSyncFromDrive_(force); } catch (err) { sync = { error: String(err) }; }
  const sh = salesSheet_();
  const last = sh.getLastRow();
  const months = [];
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, SALES_HEADER.length).getDisplayValues().forEach(r => {
      if (!r[0]) return;
      let channels = {};
      try { channels = JSON.parse(r[3] || '{}'); } catch (err) {}
      const num = v => Number(String(v).replace(/,/g, '')) || 0;
      let daily = {};
      try { daily = JSON.parse(r[9] || '{}'); } catch (err) {}
      months.push({ month: r[0], gross: num(r[1]), orders: num(r[2]), channels: channels, target: num(r[4]), updatedAt: r[5], updatedBy: r[6],
        dailyGross: num(r[7]), dailyOrders: num(r[8]), dailyChannels: daily, dailyAt: r[10] || '' });
    });
  }
  months.sort((a, b) => a.month < b.month ? -1 : 1);
  const props = PropertiesService.getScriptProperties();
  return { ok: true, months: months, syncedAt: props.getProperty('SALES_SYNCED_AT') || '', sync: sync };
}

function salesUpsert_(body) {
  const sh = salesSheet_();
  let added = 0, updated = 0;
  (body.months || []).forEach(m => {
    if (!/^\d{4}-\d{2}$/.test(m.month || '')) return;
    const values = [m.month, Number(m.gross) || 0, Number(m.orders) || 0, JSON.stringify(m.channels || {})];
    const row = salesFind_(sh, m.month);
    if (row) {
      sh.getRange(row, 1, 1, 4).setValues([values]);
      sh.getRange(row, 6, 1, 2).setValues([[new Date(), body.by || '']]);
      updated++;
    } else {
      sh.appendRow(values.concat(['', new Date(), body.by || '']));
      added++;
    }
  });
  return { ok: true, added: added, updated: updated };
}

function salesTarget_(body) {
  if (!/^\d{4}-\d{2}$/.test(body.month || '')) return { ok: false, error: 'เดือนไม่ถูกต้อง' };
  const sh = salesSheet_();
  let row = salesFind_(sh, body.month);
  if (!row) {
    sh.appendRow([body.month, 0, 0, '{}', '', new Date(), body.by || '']);
    row = sh.getLastRow();
  }
  sh.getRange(row, 5).setValue(Number(body.target) || '');
  sh.getRange(row, 6, 1, 2).setValues([[new Date(), body.by || '']]);
  return { ok: true };
}

// ---------- ดึงยอดขายจาก Google Drive อัตโนมัติ ----------
// อ่านไฟล์สรุปยอดขายรายเดือน (*full_month*.csv) ในโฟลเดอร์ sales-dashboard/data
// อ่านใหม่เฉพาะไฟล์ที่เปลี่ยน และเช็คโฟลเดอร์อย่างมากทุก 10 นาที

const SALES_FOLDER_ID = '1RlF400ua4edfipIlRO_ExvbFp0IZpFd0';
const SALES_SYNC_EVERY_MIN = 180; // ไฟล์ Dashboard มาเดือนละครั้ง เช็คทุก 3 ชั่วโมงพอ (กดปุ่ม ⟳ เพื่อดึงทันทีได้)

function salesSyncFromDrive_(force) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('SALES_SYNC_TS') || 0);
  if (!force && Date.now() - last < SALES_SYNC_EVERY_MIN * 60000) return { skipped: true };
  props.setProperty('SALES_SYNC_TS', String(Date.now()));

  let seen = {};
  try { seen = JSON.parse(props.getProperty('SALES_FILES') || '{}'); } catch (err) {}
  const sh = salesSheet_();
  const it = DriveApp.getFolderById(SALES_FOLDER_ID).getFiles();
  const latest = {}; // เดือน → ไฟล์ล่าสุดของเดือนนั้น
  while (it.hasNext()) {
    const f = it.next();
    const name = f.getName();
    if (!/full_month/i.test(name) || !/\.csv$/i.test(name)) continue;
    const key = f.getId();
    const stamp = String(f.getLastUpdated().getTime());
    if (!force && seen[key] === stamp) continue;
    const r = salesParseCsv_(f.getBlob().getDataAsString('UTF-8'));
    seen[key] = stamp;
    if (!r) continue;
    if (!latest[r.month] || latest[r.month].stamp < stamp) latest[r.month] = { r: r, stamp: stamp };
  }
  const months = Object.keys(latest).map(k => latest[k].r);
  if (months.length) salesUpsert_({ by: 'Google Drive (อัตโนมัติ)', months: months });
  props.setProperty('SALES_FILES', JSON.stringify(seen));
  props.setProperty('SALES_SYNCED_AT', new Date().toISOString());
  return { updated: months.map(m => m.month) };
}

function salesParseCsv_(text) {
  const rows = Utilities.parseCsv(String(text).replace(/^\uFEFF/, ''));
  let month = '', gross = null, orders = 0;
  const channels = {};
  rows.forEach(r => {
    const m = String(r[0] || '').match(/(\d{4}-\d{2})-\d{2}\s+to\s+\d{4}-\d{2}-\d{2}/);
    if (m && !month) month = m[1];
    const label = String(r[4] || '').trim();
    const g = Number(String(r[6] || '').replace(/,/g, ''));
    if (/Subtotal$/i.test(label) && g) channels[label.replace(/\s+Subtotal$/i, '').replace(/\s*-\s*/g, ' ')] = g;
    if (/^GRAND TOTAL$/i.test(label) && isFinite(g)) gross = g;
    const o = String(r[0] || '').match(/^Total orders:\s*(\d+)/i);
    if (o) orders = Number(o[1]);
  });
  if (!month) return null;
  if (gross === null) gross = Object.keys(channels).reduce((a, k) => a + channels[k], 0);
  return { month: month, gross: Math.round(gross * 100) / 100, orders: orders, channels: channels };
}

// กด Run ฟังก์ชันนี้หนึ่งครั้งในหน้า Apps Script เพื่ออนุญาตให้สคริปต์อ่านโฟลเดอร์ยอดขายใน Drive
// ผลที่ถูกต้อง: Execution log ขึ้นชื่อโฟลเดอร์ "data"
function authorizeDrive() {
  Logger.log(DriveApp.getFolderById(SALES_FOLDER_ID).getName());
}

// ---------- ยอดรายวันที่แอดมินอัปเอง ----------
// body.months = [{ month: '2026-11', channels: { 'Shopee A5': { g: 1234, o: 10 }, ... } }]
// อัปทีละช่องทางได้ ช่องทางที่ไม่ได้ส่งมาจะคงค่าเดิม
function salesDaily_(body) {
  const sh = salesSheet_();
  const out = [];
  (body.months || []).forEach(m => {
    if (!/^\d{4}-\d{2}$/.test(m.month || '')) return;
    let row = salesFind_(sh, m.month);
    if (!row) {
      sh.appendRow([m.month, '', '', '', '', new Date(), body.by || '']);
      row = sh.getLastRow();
    }
    let cur = {};
    try { cur = JSON.parse(sh.getRange(row, 10).getValue() || '{}'); } catch (err) {}
    Object.keys(m.channels || {}).forEach(k => {
      const c = m.channels[k] || {};
      cur[k] = { g: Math.round((Number(c.g) || 0) * 100) / 100, o: Number(c.o) || 0 };
    });
    let g = 0, o = 0;
    Object.keys(cur).forEach(k => { g += cur[k].g; o += cur[k].o; });
    sh.getRange(row, 8, 1, 4).setValues([[Math.round(g * 100) / 100, o, JSON.stringify(cur), new Date()]]);
    sh.getRange(row, 6, 1, 2).setValues([[new Date(), body.by || '']]);
    out.push({ month: m.month, gross: g, orders: o });
  });
  return { ok: true, months: out };
}
