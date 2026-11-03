// อ่านไฟล์สรุปยอดขายรายเดือน (CSV แบบ "Weekly Sales YYYY-MM-DD to YYYY-MM-DD")
// เอาเฉพาะยอดรวม: ยอดขายต่อช่องทาง (Subtotal), ยอดรวม (GRAND TOTAL), จำนวนออเดอร์
(function (root) {
  "use strict";

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  const num = (v) => {
    const n = Number(String(v || "").replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  };

  // ชื่อช่องทาง: "Shopee - A5" / "Shopee A5" → "Shopee A5"
  const channelName = (s) => s.replace(/\s+Subtotal\s*$/i, "").replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim();

  function parseSalesCsv(text) {
    const rows = parseCsv(String(text).replace(/^﻿/, ""));
    const head = rows.find((r) => /\d{4}-\d{2}-\d{2}\s+to\s+\d{4}-\d{2}-\d{2}/.test(r[0] || ""));
    if (!head) return { error: "ไม่ใช่ไฟล์สรุปยอดขาย (ไม่พบบรรทัด 'Weekly Sales … to …')" };
    const [, from, to] = head[0].match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
    const month = from.slice(0, 7);
    const channels = {};
    let gross = null, orders = null;
    for (const r of rows) {
      const label = (r[4] || "").trim();
      if (/Subtotal$/i.test(label)) {
        const g = num(r[6]);
        if (g) channels[channelName(label)] = Math.round(g * 100) / 100;
      } else if (/^GRAND TOTAL$/i.test(label)) {
        gross = num(r[6]);
      }
      const m = (r[0] || "").match(/^Total orders:\s*(\d+)/i);
      if (m) orders = Number(m[1]);
    }
    if (gross === null) gross = Object.values(channels).reduce((a, b) => a + b, 0);
    return {
      month,
      from,
      to,
      gross: Math.round(gross * 100) / 100,
      orders: orders || 0,
      channels,
      partial: to.slice(0, 7) !== month || Number(to.slice(8)) < daysIn(month),
    };
  }

  function daysIn(month) {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }

  const api = { parseSalesCsv, parseCsv };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SalesParse = api;
})(typeof window !== "undefined" ? window : globalThis);
