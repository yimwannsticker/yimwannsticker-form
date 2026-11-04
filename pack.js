// หน้า "เช็คแพ็ค": อัปโหลด PDF ใบปะ → สแกนเลขพัสดุ → ติ๊กของครบ → บันทึกคนแพ็ค
(() => {
  "use strict";

  const CFG = window.APP_CONFIG;
  const API = (CFG.SHEET_API_URL || "").trim();
  const LS_EMP = "pack_employee_v1";
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const SCANNER = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const timeTH = (iso) => (iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const sameDay = (iso, d) => iso && new Date(iso).toDateString() === d.toDateString();

  let employee = "";
  try { employee = JSON.parse(localStorage.getItem(LS_EMP)) || JSON.parse(localStorage.getItem("meter_employee_v1")) || ""; } catch {}
  let orders = [];       // จากชีต
  let loadedAt = 0;
  let current = null;    // ออเดอร์ที่กำลังเช็ค
  let ticked = new Set();
  let scanner = null;
  let parsed = null;     // ผลอ่าน PDF ที่ยังไม่ได้ส่ง

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("has-action");
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function loadScript(src) {
    return new Promise((ok, fail) => {
      if ([...document.scripts].some((s) => s.src === src)) return ok();
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => fail(new Error("โหลดไลบรารีไม่สำเร็จ เช็คอินเทอร์เน็ต"));
      document.head.appendChild(s);
    });
  }

  // ---------------- API ----------------
  async function post(body) {
    if (!API) throw new Error("ยังไม่ได้ตั้งค่า Google Sheet");
    let res;
    try {
      res = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    } catch {
      throw new Error(navigator.onLine ? "ติดต่อ Google Sheet ไม่ได้" : "ไม่มีอินเทอร์เน็ต");
    }
    const data = await res.json().catch(() => ({ ok: false, error: "ตอบกลับผิดรูปแบบ" }));
    if (data.error === "unknown action") throw new Error("ต้องอัปเดตโค้ด Apps Script (Code.gs) ก่อน");
    if (!data.ok) throw new Error(data.error || "ไม่ทราบสาเหตุ");
    return data;
  }

  async function pull(showToast) {
    if (!API) return;
    try {
      const res = await fetch(`${API}?action=pack_list`);
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.orders)) throw new Error();
      orders = data.orders;
      // รายการที่บันทึกแล้วแต่ยังส่งขึ้นชีตไม่ถึง ให้นับว่าแพ็คแล้ว
      for (const job of queue) {
        const o = orders.find((x) => x.tracking === job.tracking);
        if (o && !o.packedBy) { o.packedBy = job.by; o.packedAt = new Date().toISOString(); }
      }
      loadedAt = Date.now();
      renderProgress();
      if (showToast) toast("อัปเดตแล้ว");
    } catch {
      $("#packProgress").innerHTML = `<p class="pack-warn">โหลดรายการไม่สำเร็จ ถ้าเพิ่งเพิ่มฟีเจอร์นี้ ต้องอัปเดตโค้ด Apps Script ก่อน</p>`;
    }
  }

  // ---------------- employee ----------------
  function renderEmployees() {
    const box = $("#packEmployeeList");
    box.innerHTML = "";
    (CFG.PACKERS || CFG.EMPLOYEES).forEach((name) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "emp" + (name === employee ? " selected" : "");
      b.textContent = name;
      b.addEventListener("click", () => {
        employee = name;
        try { localStorage.setItem(LS_EMP, JSON.stringify(name)); } catch {}
        renderEmployees();
        renderProgress();
      });
      box.appendChild(b);
    });
  }

  function needEmployee() {
    if (employee) return false;
    const box = $("#packEmployeeList");
    box.classList.remove("shake");
    void box.offsetWidth;
    box.classList.add("shake");
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("เลือกชื่อคนแพ็คก่อน");
    return true;
  }

  // ชื่อ SKU ที่จะแสดง (ข้อมูลที่อัปไว้ก่อนแก้ตัวอ่าน อาจมี "Order ID: …" ติดมาในช่อง Seller SKU)
  function skuOf(it) {
    const seller = /^(Order ID|Package ID)\s*:/i.test(it.sellerSku || "") ? "" : it.sellerSku;
    return seller || it.sku;
  }

  // ---------------- scan ----------------
  // กล้องเปิดค้างไว้ระหว่างแพ็ค: สแกนแล้วแค่ "พัก" การอ่าน ไม่ปิดกล้อง → กล่องถัดไปสแกนต่อได้ทันที
  let scanPaused = false;
  let lastCode = "";
  let lastCodeAt = 0;

  function preloadScanner() {
    loadScript(SCANNER).catch(() => {});
  }

  async function startScan() {
    if (needEmployee()) return;
    if (scanner) { resumeScan(); return; }
    $("#packScanBtn").disabled = true;
    try {
      await loadScript(SCANNER);
      const F = window.Html5QrcodeSupportedFormats;
      $("#packReader").hidden = false;
      $("#packStopBtn").hidden = false;
      $("#packScanBtn").hidden = true;
      scanPaused = false;
      scanner = new window.Html5Qrcode("packReader", {
        // อ่านเฉพาะ QR code (เร็วกว่าอ่านหลายแบบพร้อมกันมาก) บาร์โค้ดใช้ช่องพิมพ์/เครื่องยิงแทน
        formatsToSupport: [F.QR_CODE],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false,
      });
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 20,
          qrbox: (w, h) => { const side = Math.floor(Math.min(w, h) * 0.7); return { width: side, height: side }; },
          videoConstraints: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        },
        onCode,
        () => {}
      );
    } catch (err) {
      stopScan();
      const msg = String(err && (err.message || err));
      toast(/Permission|NotAllowed/i.test(msg) ? "ไม่ได้รับอนุญาตให้ใช้กล้อง ไปเปิดสิทธิ์กล้องในการตั้งค่าเบราว์เซอร์" : "เปิดกล้องไม่ได้: " + msg);
    } finally {
      $("#packScanBtn").disabled = false;
    }
  }

  function onCode(text) {
    if (scanPaused) return;
    const t = String(text || "").trim();
    // ใบปะกล่องที่เพิ่งสแกนยังอยู่หน้ากล้อง → ไม่เปิดซ้ำจนกว่าจะสแกนใบอื่น
    if (t === lastCode) return;
    lastCode = t;
    lastCodeAt = Date.now();
    if (navigator.vibrate) navigator.vibrate(80);
    pauseScan();
    lookup(t);
  }

  function pauseScan() {
    scanPaused = true;
    $("#packReader").classList.add("paused");
  }

  function resumeScan() {
    if (!scanner) return;
    scanPaused = false;
    $("#packReader").classList.remove("paused");
    $("#packReader").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function stopScan() {
    const s = scanner;
    scanner = null;
    scanPaused = false;
    if (s) s.stop().catch(() => {}).finally(() => s.clear && s.clear());
    $("#packReader").hidden = true;
    $("#packReader").classList.remove("paused");
    $("#packStopBtn").hidden = true;
    $("#packScanBtn").hidden = false;
  }

  function findOrder(text) {
    const t = String(text || "").trim().toUpperCase();
    if (!t) return null;
    return (
      orders.find((o) => o.tracking.toUpperCase() === t) ||
      orders.find((o) => o.orderId && o.orderId === t) ||
      orders.find((o) => t.includes(o.tracking.toUpperCase())) ||
      null
    );
  }

  async function lookup(text) {
    if (needEmployee()) return;
    let o = findOrder(text);
    if (!o && Date.now() - loadedAt > 5000) {
      await pull();
      o = findOrder(text);
    }
    $("#packInput").value = "";
    if (!o) return showNotFound(text);
    current = o;
    ticked = new Set();
    renderResult(true);
  }

  // ---------------- result ----------------
  function showNotFound(text) {
    current = null;
    $("#packResult").innerHTML = `
      <div class="card pack-card bad">
        <div class="pack-banner bad">❌ ไม่พบเลขพัสดุนี้ในระบบ</div>
        <p class="pack-track">${esc(text)}</p>
        <p class="hint">อาจยังไม่ได้อัปโหลด PDF ชุดนี้ หรือสแกนผิดโค้ด (สแกน QR code หรือบาร์โค้ดใหญ่ของใบปะ) อย่าเพิ่งแพ็ค ให้แจ้งแอดมิน</p>
      </div>`;
    $("#packResult").scrollIntoView({ behavior: "smooth", block: "start" });
    lastCode = "";
    setTimeout(resumeScan, 1200);
  }

  function renderResult(scroll) {
    const o = current;
    const box = $("#packResult");
    if (!o) { box.innerHTML = ""; return; }
    const done = !!o.packedBy;
    const allTicked = o.items.length > 0 && ticked.size === o.items.length;
    const totalSheets = o.items.reduce((a, b) => a + (Number(b.qty) || 0), 0);
    const isNote = (it) => it.code === "!";
    const partial = o.items.some(isNote);
    const realCount = o.items.filter((it) => !isNote(it)).length;
    box.innerHTML = `
      <div class="card pack-card ${done ? "warn" : ""}">
        ${done ? `<div class="pack-banner warn">⚠️ กล่องนี้แพ็คไปแล้ว โดย <b>${esc(o.packedBy)}</b> · ${esc(timeTH(o.packedAt))}</div>` : ""}
        ${partial && !done ? `<div class="pack-banner warn">⚠️ <b>ใบปะแสดงสินค้าไม่ครบ</b> ด้านล่างคือรายการที่อ่านได้เท่านั้น เปิดคำสั่งซื้อ <b>${esc(o.orderId)}</b> ในระบบ แล้วหยิบที่เหลือให้ครบ</div>` : ""}
        <div class="row-between">
          <div>
            <div class="pack-track">${esc(o.tracking)}</div>
            <div class="muted pack-order">Order ${esc(o.orderId)}</div>
          </div>
          <div class="pack-total">${realCount}${partial ? "+" : ""} รายการ<br /><b>${totalSheets}${partial ? "+" : ""}</b> แผ่น</div>
        </div>
        <div class="pack-hint-row">
          <p class="hint">${done ? "ไม่ต้องแพ็คซ้ำ ถ้าบันทึกผิดกด “ยกเลิกการแพ็ค”" : "หยิบของทีละรายการ แล้วแตะเพื่อติ๊ก"}</p>
          ${done || !o.items.length ? "" : `<button class="btn small ghost" id="packTickAll" type="button">${allTicked ? "ยกเลิกติ๊กทั้งหมด" : "☑️ ติ๊กทุกข้อ"}</button>`}
        </div>
        <ul class="pack-items">
          ${o.items.map((it, i) => `
            <li>
              <button type="button" class="pack-item ${isNote(it) ? "note" : ""} ${ticked.has(i) || done ? "on" : ""}" data-i="${i}" ${done ? "disabled" : ""}>
                <span class="pack-code">${esc(it.code || "?")}</span>
                <span class="pack-sku"><b>${esc(skuOf(it) || "-")}</b><span class="muted">${esc(it.name)}</span></span>
                ${isNote(it) ? `<span class="pack-qty">?<small>ดูในระบบ</small></span>` : `<span class="pack-qty">×${esc(it.qty)}<small>แผ่น</small></span>`}
                <span class="pack-check" aria-hidden="true"></span>
              </button>
            </li>`).join("")}
        </ul>
        ${done
          ? `<div class="dialog-actions"><button class="btn ghost" id="packNext" type="button">สแกนกล่องถัดไป</button><button class="btn danger" id="packUndo" type="button">ยกเลิกการแพ็ค</button></div>`
          : `<button class="btn primary full big" id="packDone" type="button" ${allTicked ? "" : "disabled"}>${allTicked ? "✅ ครบแล้ว บันทึกการแพ็ค" : `ติ๊กให้ครบก่อน (${ticked.size}/${o.items.length})`}</button>
             <button class="btn ghost full pack-skip" id="packCancel" type="button">ยังไม่แพ็คกล่องนี้ สแกนกล่องอื่น</button>`}
      </div>`;
    box.querySelectorAll(".pack-item").forEach((b) =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.i);
        ticked.has(i) ? ticked.delete(i) : ticked.add(i);
        renderResult();
      })
    );
    const btnAll = $("#packTickAll");
    if (btnAll) btnAll.addEventListener("click", () => {
      // ติ๊กทุกข้อไม่รวมแถวเตือน "ใบปะไม่ครบ" ต้องกดยืนยันเองหลังเช็คในระบบ
      ticked = allTicked ? new Set() : new Set(o.items.map((it, i) => (it.code === "!" ? -1 : i)).filter((i) => i >= 0));
      renderResult();
    });
    const btnDone = $("#packDone");
    if (btnDone) btnDone.addEventListener("click", confirmPacked);
    const btnUndo = $("#packUndo");
    if (btnUndo) btnUndo.addEventListener("click", undoPacked);
    const btnNext = $("#packNext");
    if (btnNext) btnNext.addEventListener("click", () => { current = null; renderResult(); startScan(); });
    const btnCancel = $("#packCancel");
    if (btnCancel) btnCancel.addEventListener("click", () => { current = null; renderResult(); startScan(); });
    if (scroll) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // บันทึกแบบไม่ต้องรอชีต: ขึ้นว่าบันทึกแล้วทันที แล้วส่งขึ้นชีตเบื้องหลัง (ส่งไม่ผ่านจะเก็บไว้ส่งใหม่)
  const LS_QUEUE = "pack_queue_v1";
  let queue = [];
  try { queue = JSON.parse(localStorage.getItem(LS_QUEUE)) || []; } catch {}
  let flushing = false;
  const saveQueue = () => { try { localStorage.setItem(LS_QUEUE, JSON.stringify(queue)); } catch {} };

  async function flushQueue() {
    if (flushing || !queue.length) return;
    flushing = true;
    try {
      while (queue.length) {
        const job = queue[0];
        let res;
        try {
          res = await post({ action: "pack_done", tracking: job.tracking, by: job.by });
        } catch (err) {
          if (/ไม่พบเลขพัสดุ/.test(err.message)) { queue.shift(); saveQueue(); continue; }
          setTimeout(flushQueue, 8000);
          break;
        }
        queue.shift();
        saveQueue();
        if (res.already && res.packedBy !== job.by) {
          const o = orders.find((x) => x.tracking === job.tracking);
          if (o) { o.packedBy = res.packedBy; o.packedAt = res.packedAt; }
          toast(`⚠️ ${job.tracking} ถูก ${res.packedBy} บันทึกไปก่อนแล้ว`);
          renderProgress();
        }
      }
    } finally {
      flushing = false;
    }
  }

  function confirmPacked() {
    if (needEmployee() || !current) return;
    const o = current;
    o.packedBy = employee;
    o.packedAt = new Date().toISOString();
    queue.push({ tracking: o.tracking, by: employee });
    saveQueue();
    flushQueue();
    current = null;
    renderResult();
    renderProgress();
    toast(`✅ บันทึกแล้ว ${o.tracking}`);
    if (scanner) resumeScan();
    else $("#packInput").focus();
  }

  async function undoPacked() {
    const o = current;
    if (!o || !confirm(`ยกเลิกการแพ็คของ ${o.tracking} (บันทึกโดย ${o.packedBy}) ใช่มั้ย?`)) return;
    try {
      await post({ action: "pack_undo", tracking: o.tracking, by: employee });
      o.packedBy = "";
      o.packedAt = "";
      ticked = new Set();
      renderResult();
      renderProgress();
      toast("ยกเลิกแล้ว แพ็คใหม่ได้เลย");
    } catch (err) {
      toast("ยกเลิกไม่สำเร็จ: " + err.message);
    }
  }

  // ---------------- progress ----------------
  function renderProgress() {
    const box = $("#packProgress");
    if (!API) { box.innerHTML = `<p class="hint">ยังไม่ได้ตั้งค่า Google Sheet</p>`; return; }
    const today = new Date();
    const pending = orders.filter((o) => !o.packedBy);
    const doneToday = orders.filter((o) => sameDay(o.packedAt, today));
    const mine = doneToday.filter((o) => o.packedBy === employee).length;
    box.innerHTML = `
      <div class="pack-stats">
        <div><b>${pending.length}</b><span>รอแพ็ค</span></div>
        <div><b>${doneToday.length}</b><span>แพ็ควันนี้</span></div>
        <div><b>${mine}</b><span>${employee ? esc(employee) + " แพ็ค" : "ของฉัน"}</span></div>
      </div>
      ${pending.length ? `
        <details class="pack-pending" ${wide() ? "open" : ""}>
          <summary>ดูกล่องที่ยังไม่ได้แพ็ค (${pending.length})</summary>
          <ul>${pending
            .slice()
            .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))
            .map((o) => `<li><button type="button" data-t="${esc(o.tracking)}">${esc(o.tracking)}</button><span class="muted">${o.items.map((it) => (it.code === "!" ? "⚠️ ไม่ครบ" : esc(it.code || "?") + "×" + esc(it.qty))).join(", ")}</span></li>`)
            .join("")}</ul>
        </details>` : `<p class="hint">ไม่มีกล่องค้างแพ็ค 🎉</p>`}
      ${doneToday.length ? `
        <details class="pack-pending pack-done-list" ${wide() ? "open" : ""}>
          <summary>แพ็คแล้ววันนี้ (${doneToday.length})</summary>
          <ul>${doneToday
            .slice()
            .sort((a, b) => b.packedAt.localeCompare(a.packedAt))
            .map((o) => `<li><button type="button" data-t="${esc(o.tracking)}">${esc(o.tracking)}</button><span>${esc(o.packedBy)} · ${esc(timeTH(o.packedAt))}</span><span class="muted">${o.items.map((it) => (it.code === "!" ? "⚠️ ไม่ครบ" : esc(it.code || "?") + "×" + esc(it.qty))).join(", ")}</span></li>`)
            .join("")}</ul>
        </details>` : ""}`;
    box.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => lookup(b.dataset.t)));
  }

  // ---------------- upload PDF ----------------
  async function readPdf(file) {
    const prev = $("#packPreview");
    prev.innerHTML = `<p class="hint">กำลังอ่านไฟล์…</p>`;
    try {
      await loadScript(PDFJS + "pdf.min.js");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
      const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      parsed = await window.PackParse.parsePdf(doc);
      renderPreview();
    } catch (err) {
      parsed = null;
      prev.innerHTML = `<p class="pack-warn">อ่านไฟล์ไม่สำเร็จ: ${esc(err.message || err)}</p>`;
    }
  }

  function renderPreview() {
    const prev = $("#packPreview");
    const { orders: list, warnings } = parsed;
    const known = new Set(orders.map((o) => o.tracking));
    const fresh = list.filter((o) => !known.has(o.tracking));
    prev.innerHTML = `
      <p><b>อ่านได้ ${list.length} กล่อง</b>${list.length - fresh.length ? ` <span class="muted">(${list.length - fresh.length} กล่องมีในระบบแล้ว จะข้ามไป)</span>` : ""}</p>
      ${warnings.length ? `<div class="pack-warn">⚠️ ต้องเช็คด้วยตา:<ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
      <div class="table-wrap"><table class="sum-table pack-table">
        <thead><tr><th>เลขพัสดุ</th><th>รายการ</th><th>แผ่น</th></tr></thead>
        <tbody>${list.map((o) => `
          <tr class="${known.has(o.tracking) ? "zero" : ""}">
            <td>${esc(o.tracking)}</td>
            <td>${o.items.map((it) => (it.code === "!" ? `<b class="pack-note-text">⚠️ ใบปะไม่ครบ ดูที่เหลือในระบบ</b>` : `${esc(skuOf(it))} ×${esc(it.qty)}`)).join("<br />")}</td>
            <td>${o.qty}${o.incomplete ? "+" : ""}</td>
          </tr>`).join("")}</tbody>
      </table></div>
      <button class="btn primary full" id="packUpload" type="button" ${fresh.length ? "" : "disabled"}>
        ${fresh.length ? `ส่งขึ้นระบบ ${fresh.length} กล่อง` : "ไม่มีกล่องใหม่"}
      </button>`;
    const btn = $("#packUpload");
    btn.addEventListener("click", async () => {
      if (needEmployee()) return;
      btn.disabled = true;
      btn.textContent = "กำลังส่ง…";
      try {
        const res = await post({ action: "pack_upload", by: employee, orders: fresh });
        toast(`ส่งแล้ว ${res.added} กล่อง` + (res.skipped ? ` (ข้าม ${res.skipped})` : ""));
        parsed = null;
        $("#packPreview").innerHTML = `<p class="hint">✅ ส่งขึ้นระบบแล้ว ${res.added} กล่อง เริ่มแพ็คได้เลย</p>`;
        $("#packFile").value = "";
        await pull();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = `ส่งขึ้นระบบ ${fresh.length} กล่อง`;
        toast("ส่งไม่สำเร็จ: " + err.message);
      }
    });
  }

  // จอคอม: เปิดส่วนอัปโหลดและรายการไว้เลย
  function wide() {
    return window.matchMedia("(min-width: 900px)").matches;
  }

  // ---------------- init ----------------
  renderEmployees();
  if (wide()) $("#packAdmin").open = true;
  $("#packScanBtn").addEventListener("click", startScan);
  $("#packStopBtn").addEventListener("click", stopScan);
  $("#packManual").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#packInput").value.trim();
    if (v) lookup(v);
  });
  $("#packRefresh").addEventListener("click", () => pull(true));
  $("#packFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) readPdf(f);
  });
  window.addEventListener("viewchange", (e) => {
    if (e.detail === "pack") {
      preloadScanner();
      flushQueue();
      renderEmployees();
      pull();
    } else if (scanner) stopScan();
  });
})();
