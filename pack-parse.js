// อ่านใบปะหน้า TikTok Shop (PDF แบบมีรายละเอียดสินค้า) → รายการออเดอร์
// ใช้ได้ทั้งในเบราว์เซอร์ (window.PackParse) และใน Node (module.exports) เพื่อทดสอบ
(function (root) {
  "use strict";

  const TRACKING_RE = /^[A-Z]{2,}[A-Z0-9]{8,}$/;

  function lineText(items) {
    // ต่อชิ้นข้อความในบรรทัดเดียวกันตามตำแหน่ง x
    items.sort((a, b) => a.x - b.x);
    let s = "";
    let end = null;
    for (const it of items) {
      if (end !== null && it.x - end > 1.5) s += " ";
      s += it.str;
      end = it.x + it.w;
    }
    return s.trim();
  }

  // ตัดอักขระแปลกจากฟอนต์ใน PDF ออก
  function clean(s) {
    return String(s).replace(/[\u0000-\u001f\u007f-\u009f\ue000-\uf8ff\ufffd]/g, "").replace(/\s+/g, " ").trim();
  }

  function joinLines(lines) {
    // SKU ที่ตัดบรรทัดตรง "-" ต่อกันโดยไม่เว้นวรรค
    let s = "";
    for (const l of lines) {
      if (!l) continue;
      if (!s || s.endsWith("-") || l.startsWith("-")) s += l;
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
      if (TRACKING_RE.test(t) && (t.match(/\d/g) || []).length >= 8) count[t] = (count[t] || 0) + 1;
    }
    let best = "";
    for (const t in count) if (!best || count[t] > count[best]) best = t;
    return best;
  }

  function findOrderId(items) {
    for (let i = 0; i < items.length; i++) {
      const s = items[i].str;
      const m = s.match(/Order ID:\s*(\d{10,})/);
      if (m) return m[1];
      if (/Order ID:\s*$/.test(s)) {
        const next = items.slice(i + 1).find((x) => x.str.trim());
        if (next && /^\d{10,}$/.test(next.str.trim())) return next.str.trim();
      }
    }
    return "";
  }

  // แยกตารางสินค้าบนหน้าเดียว
  function parseTable(items, cols, pageTop) {
    const header = items.find((it) => it.str.trim() === "Product Name");
    const top = header ? header.y - 2 : pageTop;
    const totalItem = items.find((it) => /^Qty Total:?$/.test(it.str.trim()));
    const bottom = totalItem ? totalItem.y + 2 : -1;
    let qtyTotal = null;
    if (totalItem) {
      const t = items.find((it) => Math.abs(it.y - totalItem.y) < 2 && it.x > totalItem.x && /^\d+$/.test(it.str.trim()));
      if (t) qtyTotal = Number(t.str.trim());
    }
    const body = items.filter((it) => it.y < top && it.y > bottom && it.str.trim());
    const qtys = body
      .filter((it) => it.x >= cols.qty - 6 && /^\d+$/.test(it.str.trim()))
      .sort((a, b) => b.y - a.y);
    const rows = qtys.map((q, i) => {
      const lower = i + 1 < qtys.length ? qtys[i + 1].y + 2 : bottom;
      const inRow = body.filter((it) => it.y <= q.y + 2 && it.y > lower);
      const pick = (lo, hi) => joinLines(groupLines(inRow.filter((it) => it.x >= lo && it.x < hi)));
      return {
        name: clean(pick(-1, cols.sku - 2)),
        sku: clean(pick(cols.sku - 2, cols.seller - 2)),
        sellerSku: clean(pick(cols.seller - 2, cols.qty - 6)),
        qty: Number(q.str.trim()),
      };
    });
    return { rows, qtyTotal, hasTable: !!header || rows.length > 0 };
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

      const head = {};
      for (const it of items) {
        const s = it.str.trim();
        if (s === "SKU" && head.sku === undefined) head.sku = it.x;
        else if (s === "Seller SKU") head.seller = it.x;
        else if (s === "Qty" && head.qty === undefined) head.qty = it.x;
      }
      if (head.sku !== undefined && head.qty !== undefined) {
        cols = { sku: head.sku, seller: head.seller !== undefined ? head.seller : head.qty - 40, qty: head.qty };
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
        prev.pages.push(p);
      } else if (tracking) {
        orders.push({ tracking, orderId, items: table.rows, qtyTotal: table.qtyTotal, pages: [p] });
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
    }
    return { orders, warnings };
  }

  const api = { parsePdf, designCode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PackParse = api;
})(typeof window !== "undefined" ? window : globalThis);
