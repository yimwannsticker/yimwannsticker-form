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
    CFG.EMPLOYEES.forEach((name) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "emp" + (name === employee ? " selected" : "");
      b.textContent = name;
      b.addEventListener("click", () => {
        employee = name;
        try { localStorage.setItem(LS_EMP, JSON.stringify(name)); } catch {}
        renderEmployees();
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

  // ---------------- scan ----------------
  async function startScan() {
    if (needEmployee()) return;
    $("#packScanBtn").disabled = true;
    try {
      await loadScript(SCANNER);
      const F = window.Html5QrcodeSupportedFormats;
      $("#packReader").hidden = false;
      $("#packStopBtn").hidden = false;
      $("#packScanBtn").hidden = true;
      scanner = new window.Html5Qrcode("packReader", {
        formatsToSupport: [F.CODE_128, F.CODE_39, F.QR_CODE],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false,
      });
      await scanner.start(
        { facingMode: "environment" },
        { fps: 12, qrbox: (w, h) => { const side = Math.floor(Math.min(w * 0.8, h * 0.8)); return { width: side, height: side }; } },
        (text) => {
          if (navigator.vibrate) navigator.vibrate(80);
          stopScan();
          lookup(text);
        },
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

  function stopScan() {
    const s = scanner;
    scanner = null;
    if (s) s.stop().catch(() => {}).finally(() => s.clear && s.clear());
    $("#packReader").hidden = true;
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
  }

  function renderResult(scroll) {
    const o = current;
    const box = $("#packResult");
    if (!o) { box.innerHTML = ""; return; }
    const done = !!o.packedBy;
    const allTicked = o.items.length > 0 && ticked.size === o.items.length;
    const totalSheets = o.items.reduce((a, b) => a + (Number(b.qty) || 0), 0);
    box.innerHTML = `
      <div class="card pack-card ${done ? "warn" : ""}">
        ${done ? `<div class="pack-banner warn">⚠️ กล่องนี้แพ็คไปแล้ว โดย <b>${esc(o.packedBy)}</b> · ${esc(timeTH(o.packedAt))}</div>` : ""}
        <div class="row-between">
          <div>
            <div class="pack-track">${esc(o.tracking)}</div>
            <div class="muted small-text">Order ${esc(o.orderId)}</div>
          </div>
          <div class="pack-total">${o.items.length} รายการ<br /><b>${totalSheets}</b> แผ่น</div>
        </div>
        <div class="pack-hint-row">
          <p class="hint">${done ? "ไม่ต้องแพ็คซ้ำ ถ้าบันทึกผิดกด “ยกเลิกการแพ็ค”" : "หยิบของทีละรายการ แล้วแตะเพื่อติ๊ก"}</p>
          ${done || !o.items.length ? "" : `<button class="btn small ghost" id="packTickAll" type="button">${allTicked ? "ยกเลิกติ๊กทั้งหมด" : "☑️ ติ๊กทุกข้อ"}</button>`}
        </div>
        <ul class="pack-items">
          ${o.items.map((it, i) => `
            <li>
              <button type="button" class="pack-item ${ticked.has(i) || done ? "on" : ""}" data-i="${i}" ${done ? "disabled" : ""}>
                <span class="pack-code">${esc(it.code || "?")}</span>
                <span class="pack-sku"><b>${esc(it.sellerSku || it.sku || "-")}</b><span class="muted">${esc(it.name)}</span></span>
                <span class="pack-qty">×${esc(it.qty)}<small>แผ่น</small></span>
                <span class="pack-check" aria-hidden="true"></span>
              </button>
            </li>`).join("")}
        </ul>
        ${done
          ? `<div class="dialog-actions"><button class="btn ghost" id="packNext" type="button">สแกนกล่องถัดไป</button><button class="btn danger" id="packUndo" type="button">ยกเลิกการแพ็ค</button></div>`
          : `<button class="btn primary full big" id="packDone" type="button" ${allTicked ? "" : "disabled"}>${allTicked ? "✅ ครบแล้ว บันทึกการแพ็ค" : `ติ๊กให้ครบก่อน (${ticked.size}/${o.items.length})`}</button>`}
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
      ticked = allTicked ? new Set() : new Set(o.items.map((_, i) => i));
      renderResult();
    });
    const btnDone = $("#packDone");
    if (btnDone) btnDone.addEventListener("click", confirmPacked);
    const btnUndo = $("#packUndo");
    if (btnUndo) btnUndo.addEventListener("click", undoPacked);
    const btnNext = $("#packNext");
    if (btnNext) btnNext.addEventListener("click", () => { current = null; renderResult(); startScan(); });
    if (scroll) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function confirmPacked() {
    if (needEmployee() || !current) return;
    const o = current;
    const btn = $("#packDone");
    btn.disabled = true;
    btn.textContent = "กำลังบันทึก…";
    try {
      const res = await post({ action: "pack_done", tracking: o.tracking, by: employee });
      if (res.already) {
        o.packedBy = res.packedBy;
        o.packedAt = res.packedAt;
        renderResult();
        toast(`กล่องนี้ ${res.packedBy} บันทึกไปแล้ว`);
        return;
      }
      o.packedBy = employee;
      o.packedAt = new Date().toISOString();
      current = null;
      renderResult();
      renderProgress();
      toast(`✅ บันทึกแล้ว ${o.tracking}`);
      $("#packInput").focus();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "✅ ครบแล้ว บันทึกการแพ็ค";
      toast("บันทึกไม่สำเร็จ: " + err.message);
    }
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
        <details class="pack-pending">
          <summary>ดูกล่องที่ยังไม่ได้แพ็ค (${pending.length})</summary>
          <ul>${pending
            .slice()
            .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))
            .map((o) => `<li><button type="button" data-t="${esc(o.tracking)}">${esc(o.tracking)}</button><span class="muted">${o.items.map((it) => esc(it.code || "?") + "×" + esc(it.qty)).join(", ")}</span></li>`)
            .join("")}</ul>
        </details>` : `<p class="hint">ไม่มีกล่องค้างแพ็ค 🎉</p>`}`;
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
            <td>${o.items.map((it) => `${esc(it.sellerSku || it.sku)} ×${esc(it.qty)}`).join("<br />")}</td>
            <td>${o.qty}</td>
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

  // ---------------- init ----------------
  renderEmployees();
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
      renderEmployees();
      pull();
    } else if (scanner) stopScan();
  });
})();
