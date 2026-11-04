// อ่านใบปะหน้า TikTok Shop (PDF แบบมีรายละเอียดสินค้า) → รายการออเดอร์
// ใช้ได้ทั้งในเบราว์เซอร์ (window.PackParse) และใน Node (module.exports) เพื่อทดสอบ
(function (root) {
  "use strict";

  const TRACKING_RE = /^[A-Z]{2,}[A-Z0-9]{8,}$/;

  function lineText(items) {
    // ต่อชิ้นข้อความในบรรทัดเดียวกันตามตำแหน่ง x
    // สระ/วรรณยุกต์ที่แยกเป็นชิ้นเดี่ยว ให้อยู่ก่อนตัวอักษรที่เริ่มตรงตำแหน่งเดียวกัน
    items.sort((a, b) => (a.x - (a.mark ? 0.01 : 0)) - (b.x - (b.mark ? 0.01 : 0)));
    let s = "";
    let end = null;
    for (const it of items) {
      if (end !== null && it.x - end > 1.5) s += " ";
      s += it.str;
      end = it.x + it.w;
    }
    return s.trim();
  }

  // ฟอนต์ไทยบางตัวใช้รหัส Private Use (F700–F71A) แทนสระ/วรรณยุกต์ที่เลื่อนตำแหน่ง → แปลงกลับเป็นตัวจริง
  const PUA = "\u0e10\u0e34\u0e35\u0e36\u0e37\u0e48\u0e49\u0e4a\u0e4b\u0e4c\u0e48\u0e49\u0e4a\u0e4b\u0e4c\u0e0d\u0e31\u0e4d\u0e47\u0e48\u0e49\u0e4a\u0e4b\u0e4c\u0e38\u0e39\u0e3a";
  function fixThai(s) {
    return String(s).replace(/[\uf700-\uf71a]/g, (c) => PUA[c.charCodeAt(0) - 0xf700]);
  }

  // เทียบหัวตาราง: ตัดสระบน/ล่าง/วรรณยุกต์ออก เพราะฟอนต์ใน PDF ทำให้หายบ้างไม่หายบ้าง
  function key(s) {
    return fixThai(s).trim().replace(/\u0e33/g, "\u0e32").replace(/[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\s]/g, "");
  }
  const H = {
    name: ["Product Name", key("ชื่อสินค้า")],
    sku: ["SKU", key("ตัวเลือกสินค้า")],
    seller: ["Seller SKU"],
    qty: ["Qty", key("จำนวน")],
    total: ["Qty Total:", "Qty Total", key("จำนวนรวม")],
  };
  for (const k in H) H[k] = H[k].map(key);
  const isH = (it, k) => H[k].includes(key(it.str));

  // ตัดอักขระแปลกจากฟอนต์ใน PDF ออก
  function clean(s) {
    return fixThai(s).normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\ue000-\uf8ff\ufffd]/g, "").replace(/\s+/g, " ").trim();
  }

  const THAI_END = /[\u0e01-\u0e4e\uf700-\uf71a]$/;
  const THAI_START = /^[\u0e01-\u0e4e\uf700-\uf71a]/;
  const MARK_ONLY = /^[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\uf700-\uf71a]+$/;

  const TRUNC_RE = /มากกว่านี้|มีสินค้าอีก|รายการอื่น|ดูรายละเอียด(เพิ่มเติม)?ใน|ดูในระบบ|ดูเพิ่มเติม|more items?|and \d+ more/i;
  const NOTE_CODE = "!";

  function joinLines(lines) {
    // SKU ที่ตัดบรรทัดตรง "-" ต่อกันโดยไม่เว้นวรรค
    let s = "";
    for (const l of lines) {
      if (!l) continue;
      // ตัดบรรทัดกลางคำไทย (ไทยไม่มีเว้นวรรค) หรือที่ "-" → ต่อกันโดยไม่เว้นวรรค
      if (!s || s.endsWith("-") || l.startsWith("-") || (THAI_END.test(s) && THAI_START.test(l))) s += l;
      else s += " " + l;
    }
    return s;
  }

  function groupLines(items) {
    // จัดกลุ่มตาม y (บนลงล่าง)
    const sorted = items.slice().sort((a, b) => b.y - a.y);
    const lines = [];
    for (const it of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= 2) last.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    return lines.map((l) => lineText(l.items));
  }

  function findTracking(items) {
    const count = {};
    for (const it of items) {
      const t = it.str.trim();
      // J&T: JTTH + 12 หลัก, SPX: TH + 12 หลัก + ตัวอักษร, Flash: TH + ตัวเลข/ตัวอักษรปน (เช่น TH54019B0ARK0P)
      if (TRACKING_RE.test(t) && t.length <= 22 && (t.match(/\d/g) || []).length >= 5) count[t] = (count[t] || 0) + 1;
    }
    let best = "";
    for (const t in count) if (!best || count[t] > count[best] || (count[t] === count[best] && t.length > best.length)) best = t;
    return best;
  }

  function findOrderId(items) {
    for (let i = 0; i < items.length; i++) {
      const s = items[i].str;
      const m = s.match(/Order (?:ID:|No\.?)\s*([A-Z0-9]{10,})/);
      if (m) return m[1];
      if (/Order (?:ID:|No\.?)\s*$/.test(s)) {
        const next = items.slice(i + 1).find((x) => x.str.trim());
        if (next && /^[A-Z0-9]{10,}$/.test(next.str.trim())) return next.str.trim();
      }
    }
    return "";
  }

  // แยกตารางสินค้าบนหน้าเดียว
  function parseTable(items, cols, pageTop) {
    const header = items.find((it) => isH(it, "name"));
    const top = header ? header.y - 2 : pageTop;
    const totalItem = items.find((it) => isH(it, "total"));
    // ท้ายหน้ามีบรรทัด "Order ID: …" (TikTok) ทุกหน้า ถ้าหน้านี้ไม่มี Qty Total (ออเดอร์ล้นไปหน้าถัดไป) ให้ใช้บรรทัดนั้นเป็นขอบล่างของตาราง
    const footer = items
      .filter((it) => /^(Order ID|Package ID)\s*:/i.test(it.str.trim()) && it.y < top)
      .sort((a, b) => b.y - a.y)[0];
    const bottom = Math.max(totalItem ? totalItem.y + 2 : -1, footer ? footer.y + 2 : -1);
    let qtyTotal = null;
    if (totalItem) {
      const t = items.find((it) => Math.abs(it.y - totalItem.y) < 2 && it.x > totalItem.x && /^\d+$/.test(it.str.trim()));
      if (t) qtyTotal = Number(t.str.trim());
    }
    const body = items.filter((it) => it.y < top && it.y > bottom && it.str.trim());
    const qtys = body
      .filter((it) => it.x >= cols.qty - 6 && /^\d+$/.test(it.str.trim()))
      .sort((a, b) => b.y - a.y);
    // TikTok: จำนวนอยู่บรรทัดแรกของแถว / Shopee: จำนวนอยู่กลางแถว (ชื่อสินค้าคร่อมบน-ล่าง)
    const centered = qtys.length > 0 && body.some((it) => it.y > qtys[0].y + 2 && it.x < cols.qty - 6);
    const rows = qtys.map((q, i) => {
      let upper, lower;
      if (centered) {
        upper = i > 0 ? (qtys[i - 1].y + q.y) / 2 : top;
        lower = i + 1 < qtys.length ? (q.y + qtys[i + 1].y) / 2 : bottom;
      } else {
        upper = q.y + 2;
        lower = i + 1 < qtys.length ? qtys[i + 1].y + 2 : bottom;
      }
      const inRow = body.filter((it) => it.y <= upper && it.y > lower);
      const pick = (lo, hi) => joinLines(groupLines(inRow.filter((it) => it.x >= lo && it.x < hi)));
      return {
        name: clean(pick(cols.name - 2, cols.sku - 2)),
        sku: clean(pick(cols.sku - 2, cols.seller - 2)),
        sellerSku: clean(pick(cols.seller - 2, cols.qty - 6)),
        qty: Number(q.str.trim()),
      };
    });
    // Shopee: ถ้าสินค้าเยอะเกินใบ จะมีข้อความบอกว่ายังมีรายการอื่น และไม่มีช่องจำนวนรวม
    const truncated = items.some((it) => TRUNC_RE.test(clean(it.str)));
    return { rows, qtyTotal, truncated, hasTable: !!header || rows.length > 0 };
  }

  function designCode(sku) {
    const m = String(sku || "").match(/^\s*(\d{1,3})\s*-/);
    return m ? m[1] : "";
  }

  async function parsePdf(pdfDoc) {
    const orders = [];
    const warnings = [];
    let cols = null;
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p);
      const tc = await page.getTextContent();
      const pageTop = page.view[3];
      const items = tc.items
        .filter((it) => typeof it.str === "string")
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }));
      // สระล่าง/วรรณยุกต์บางตัวถูกวางเป็นชิ้นแยก ตำแหน่ง y ต่ำกว่าบรรทัด → ย้ายไปบรรทัดของตัวอักษรที่มันเกาะ
      for (const m of items) {
        if (!MARK_ONLY.test(m.str.trim())) continue;
        m.mark = true;
        let best = null;
        for (const b of items) {
          if (b === m || MARK_ONLY.test(b.str.trim()) || !b.str.trim()) continue;
          if (m.x < b.x - 0.5 || m.x > b.x + b.w + 0.5) continue;
          const dy = Math.abs(b.y - m.y);
          if (dy > 10) continue;
          // ชิดขอบตัวอักษร (ต่อท้าย/ก่อนหน้า) สำคัญกว่าแค่อยู่ในช่วง x
          const edge = Math.abs(b.x + b.w - m.x) < 0.6 || Math.abs(b.x - m.x) < 0.6 ? 0 : 1;
          if (!best || edge < best.edge || (edge === best.edge && dy < best.dy)) best = { edge, dy, y: b.y };
        }
        if (best) m.y = best.y;
      }

      const head = {};
      for (const it of items) {
        const s = it.str.trim();
        if (isH(it, "name") && head.name === undefined) head.name = it.x;
        else if (isH(it, "sku") && head.sku === undefined) head.sku = it.x;
        else if (isH(it, "seller")) head.seller = it.x;
        else if (isH(it, "qty") && head.qty === undefined) head.qty = it.x;
      }
      if (head.sku !== undefined && head.qty !== undefined) {
        cols = {
          name: head.name !== undefined ? head.name : -1,
          sku: head.sku,
          seller: head.seller !== undefined ? head.seller : head.qty - 6,
          qty: head.qty,
        };
      }

      const tracking = findTracking(items);
      const orderId = findOrderId(items);
      if (!cols) {
        warnings.push(`หน้า ${p}: ไม่พบตารางสินค้า (อาจเป็นใบปะแบบไม่มีรายละเอียด)`);
        continue;
      }
      const table = parseTable(items, cols, pageTop);
      const prev = orders[orders.length - 1];
      const isContinuation = prev && (!tracking || tracking === prev.tracking);

      if (isContinuation) {
        prev.items.push(...table.rows);
        if (table.qtyTotal !== null) prev.qtyTotal = table.qtyTotal;
        if (table.truncated) prev.truncated = true;
        prev.pages.push(p);
      } else if (tracking) {
        orders.push({ tracking, orderId, items: table.rows, qtyTotal: table.qtyTotal, truncated: table.truncated, pages: [p] });
      } else {
        warnings.push(`หน้า ${p}: หาเลขพัสดุไม่เจอ`);
      }
    }

    for (const o of orders) {
      o.items.forEach((it) => (it.code = designCode(it.sellerSku) || designCode(it.sku)));
      const sum = o.items.reduce((a, b) => a + b.qty, 0);
      o.qty = sum;
      if (!o.items.length) warnings.push(`${o.tracking}: อ่านรายการสินค้าไม่ได้`);
      else if (o.qtyTotal !== null && o.qtyTotal !== sum)
        warnings.push(`${o.tracking}: จำนวนรวมไม่ตรง (อ่านได้ ${sum} แต่ใบปะบอก ${o.qtyTotal})`);
      // ใบปะแสดงสินค้าไม่ครบ (มีข้อความบอก หรือไม่มีช่องจำนวนรวม) → เพิ่มแถวเตือนให้คนแพ็คต้องติ๊กยืนยัน
      o.incomplete = !!o.truncated || (o.items.length > 0 && o.qtyTotal === null);
      if (o.incomplete) {
        o.items.push({ code: NOTE_CODE, sku: "ใบปะแสดงสินค้าไม่ครบ", sellerSku: "", name: "เปิดคำสั่งซื้อนี้ในระบบ แล้วหยิบรายการที่เหลือให้ครบ", qty: 0 });
        warnings.push(`${o.tracking}: ใบปะแสดงสินค้าไม่ครบ อ่านได้ ${o.items.length - 1} รายการ ${sum} แผ่น คนแพ็คต้องเช็ครายการที่เหลือในระบบ`);
      }
    }
    return { orders, warnings };
  }

  const api = { parsePdf, designCode, NOTE_CODE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PackParse = api;
})(typeof window !== "undefined" ? window : globalThis);
