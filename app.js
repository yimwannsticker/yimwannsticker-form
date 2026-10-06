(() => {
  "use strict";

  const CFG = window.APP_CONFIG;
  const API = (CFG.SHEET_API_URL || "").trim();
  const API_OK = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\/?$/.test(API);
  const VARIANTS = [
    { id: "color", name: "สี", dot: "color" },
    { id: "bw", name: "ขาวดำ", dot: "bw" },
  ];
  // ลำดับคอลัมน์เหมือน Google Form เดิม
  const FIELDS = CFG.MATERIALS.flatMap((m) =>
    VARIANTS.map((v) => ({
      key: `${m.id}__${v.id}`,
      label: `${m.name} - ${v.name} (แผ่น)`,
      short: `${m.name} ${v.name}`,
      mat: m,
      variant: v,
    }))
  );

  const LS = {
    records: "meter_records_v1",
    draft: "meter_draft_v1",
    employee: "meter_employee_v1",
  };

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const fmt = (n) => Number(n || 0).toLocaleString("th-TH");
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  // ---------------- state ----------------
  let draft = load(LS.draft, {}); // { key: [numbers] }
  let employee = load(LS.employee, "");
  let records = load(LS.records, []);

  function emptyDraft() {
    return Object.fromEntries(FIELDS.map((f) => [f.key, []]));
  }
  draft = Object.assign(emptyDraft(), draft);

  // ---------------- toast ----------------
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // ---------------- tabs ----------------
  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
      const view = t.dataset.view;
      $("#view-record").hidden = view !== "record";
      $("#bottombar").hidden = view !== "record";
      $("#view-history").hidden = view !== "history";
      if (view === "history") {
        renderHistory();
        if (API) pullRemote();
      }
      window.scrollTo({ top: 0 });
    })
  );

  // ---------------- employee ----------------
  function renderEmployees() {
    const box = $("#employeeList");
    box.innerHTML = "";
    CFG.EMPLOYEES.forEach((name) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "emp" + (name === employee ? " selected" : "");
      b.textContent = name;
      b.addEventListener("click", () => {
        employee = name;
        save(LS.employee, employee);
        renderEmployees();
      });
      box.appendChild(b);
    });
  }

  // ---------------- materials ----------------
  function parseNumbers(text) {
    const parts = String(text).split(/[\s,+]+/).filter(Boolean);
    const nums = [];
    for (const p of parts) {
      if (!/^\d+$/.test(p)) return null;
      const n = parseInt(p, 10);
      if (n > 0) nums.push(n);
    }
    return nums;
  }

  function renderMaterials() {
    const box = $("#materialList");
    box.innerHTML = "";
    CFG.MATERIALS.forEach((m) => {
      const card = document.createElement("article");
      card.className = "material";
      card.style.setProperty("--mc", m.color);
      card.innerHTML = `
        <div class="material-head">
          <h3><span>${m.emoji}</span>${m.name}</h3>
          <span class="material-sum">รวม <b data-matsum="${m.id}">0</b> แผ่น</span>
        </div>
        <div class="variants"></div>`;
      const vbox = $(".variants", card);
      VARIANTS.forEach((v) => {
        const key = `${m.id}__${v.id}`;
        const el = document.createElement("div");
        el.className = "variant";
        el.innerHTML = `
          <div class="variant-label">
            <span><span class="dot ${v.dot}"></span>${v.name}</span>
            <span class="variant-total" data-total="${key}">0</span>
          </div>
          <div class="entry">
            <input type="text" inputmode="numeric" enterkeyhint="enter" autocomplete="off"
              placeholder="จำนวนแผ่น เช่น 12" aria-label="${m.name} ${v.name}" data-input="${key}" />
            <button type="button" class="add-btn" aria-label="เพิ่ม" data-add="${key}">＋</button>
          </div>
          <div class="nums" data-nums="${key}"></div>
          <div class="formula" data-formula="${key}"></div>`;
        vbox.appendChild(el);

        const input = $("input", el);
        const commit = (fromBlur) => {
          const raw = input.value.trim();
          if (!raw) return true;
          const nums = parseNumbers(raw);
          if (nums === null) {
            toast("ใส่ได้เฉพาะตัวเลขนะ 🙏");
            if (fromBlur !== true) input.select();
            return false;
          }
          draft[key].push(...nums);
          input.value = "";
          saveDraft();
          renderField(key);
          return true;
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        });
        input.addEventListener("input", () => {
          // พิมพ์ + เว้นวรรค หรือ , ท้ายตัวเลข = เพิ่มงานถัดไปทันที
          if (/^\d+[+\s,]$/.test(input.value)) commit();
        });
        input.addEventListener("blur", () => commit(true));
        $(".add-btn", el).addEventListener("click", () => {
          if (commit()) input.focus();
        });
      });
      box.appendChild(card);
    });
    FIELDS.forEach((f) => renderField(f.key));
  }

  function renderField(key) {
    const nums = draft[key];
    const total = sum(nums);
    const numsBox = $(`[data-nums="${key}"]`);
    numsBox.innerHTML = "";
    nums.forEach((n, i) => {
      const chip = document.createElement("span");
      chip.className = "num";
      chip.innerHTML = `${fmt(n)}<button type="button" aria-label="ลบ ${n}">✕</button>`;
      $("button", chip).addEventListener("click", () => {
        draft[key].splice(i, 1);
        saveDraft();
        renderField(key);
      });
      numsBox.appendChild(chip);
    });
    const totalEl = $(`[data-total="${key}"]`);
    totalEl.textContent = fmt(total);
    totalEl.classList.toggle("zero", total === 0);
    $(`[data-formula="${key}"]`).textContent =
      nums.length > 1 ? `${nums.map(fmt).join(" + ")} = ${fmt(total)}` : "";

    const matId = key.split("__")[0];
    const matTotal = sum(VARIANTS.map((v) => sum(draft[`${matId}__${v.id}`])));
    $(`[data-matsum="${matId}"]`).textContent = fmt(matTotal);
    $("#grandTotal").textContent = fmt(grandTotal());
  }

  const grandTotal = () => sum(FIELDS.map((f) => sum(draft[f.key])));
  const saveDraft = () => save(LS.draft, draft);

  // commit ค่าที่ยังค้างอยู่ในช่อง input (กรณีพิมพ์แล้วยังไม่กด Enter)
  function flushInputs() {
    let ok = true;
    $$("[data-input]").forEach((input) => {
      if (!input.value.trim()) return;
      const nums = parseNumbers(input.value);
      if (nums === null) {
        ok = false;
        return;
      }
      draft[input.dataset.input].push(...nums);
      input.value = "";
      renderField(input.dataset.input);
    });
    saveDraft();
    return ok;
  }

  // ---------------- clear / submit ----------------
  $("#btnClear").addEventListener("click", () => {
    if (grandTotal() === 0) return;
    if (!confirm("ล้างตัวเลขที่กรอกไว้ทั้งหมด?")) return;
    draft = emptyDraft();
    saveDraft();
    FIELDS.forEach((f) => renderField(f.key));
  });

  $("#btnSubmit").addEventListener("click", () => {
    if (!flushInputs()) {
      toast("มีช่องที่ไม่ใช่ตัวเลข ลองตรวจอีกทีนะ");
      return;
    }
    if (!employee) {
      const box = $("#employeeList");
      box.classList.remove("shake");
      void box.offsetWidth;
      box.classList.add("shake");
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      toast("เลือกชื่อคนพิมพ์ก่อนนะ 😊");
      return;
    }
    if (grandTotal() === 0) {
      toast("ยังไม่ได้กรอกจำนวนแผ่นเลย");
      return;
    }
    $("#confirmWho").textContent = `พนักงาน: ${employee} · ${new Date().toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    })}`;
    $("#confirmTable").innerHTML = summaryTable(
      Object.fromEntries(FIELDS.map((f) => [f.key, sum(draft[f.key])])),
      draft
    );
    $("#confirmDialog").showModal();
  });

  $("#confirmDialog").addEventListener("close", async () => {
    if ($("#confirmDialog").returnValue !== "ok") return;
    const rec = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      ts: new Date().toISOString(),
      employee,
      totals: Object.fromEntries(FIELDS.map((f) => [f.key, sum(draft[f.key])])),
      details: Object.fromEntries(FIELDS.map((f) => [f.key, [...draft[f.key]]])),
      synced: !API,
    };
    records.unshift(rec);
    save(LS.records, records);
    draft = emptyDraft();
    saveDraft();
    FIELDS.forEach((f) => renderField(f.key));
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast(`บันทึกแล้ว ${fmt(sum(Object.values(rec.totals)))} แผ่น 🎉`);
    if (API) await pushPending();
  });

  // ---------------- summary table ----------------
  function summaryTable(totals, details) {
    const rows = CFG.MATERIALS.map((m) => {
      const cells = VARIANTS.map((v) => {
        const key = `${m.id}__${v.id}`;
        const t = totals[key] || 0;
        const d = details && details[key] && details[key].length > 1
          ? `<span class="detail">${details[key].map(fmt).join("+")}</span>` : "";
        return `<td class="${t ? "" : "zero"}">${t ? fmt(t) : "–"}${d}</td>`;
      }).join("");
      const rowTotal = sum(VARIANTS.map((v) => totals[`${m.id}__${v.id}`] || 0));
      return `<tr><td>${m.emoji} ${m.name}</td>${cells}<td class="${rowTotal ? "" : "zero"}"><b>${rowTotal ? fmt(rowTotal) : "–"}</b></td></tr>`;
    }).join("");
    const colTotals = VARIANTS.map((v) =>
      sum(CFG.MATERIALS.map((m) => totals[`${m.id}__${v.id}`] || 0))
    );
    return `
      <table class="sum-table">
        <thead><tr><th>วัสดุ</th>${VARIANTS.map((v) => `<th>${v.name}</th>`).join("")}<th>รวม</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>รวมทั้งหมด</td>${colTotals.map((t) => `<td>${fmt(t)}</td>`).join("")}<td>${fmt(sum(colTotals))}</td></tr></tfoot>
      </table>`;
  }

  // ---------------- history ----------------
  const dateKey = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };

  function setRange(range) {
    const now = new Date();
    let from = new Date(now);
    let to = new Date(now);
    if (range === "yesterday") {
      from.setDate(now.getDate() - 1);
      to = new Date(from);
    } else if (range === "week") {
      from.setDate(now.getDate() - 6);
    } else if (range === "month") {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    $("#fFrom").value = dateKey(from);
    $("#fTo").value = dateKey(to);
    $$(".pill").forEach((p) => p.classList.toggle("active", p.dataset.range === range));
    renderHistory();
  }

  function filteredRecords() {
    const from = $("#fFrom").value;
    const to = $("#fTo").value;
    const emp = $("#fEmp").value;
    return records
      .filter((r) => {
        const d = dateKey(r.ts);
        return (!from || d >= from) && (!to || d <= to) && (!emp || r.employee === emp);
      })
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }

  function renderHistory() {
    const list = filteredRecords();
    const totals = Object.fromEntries(
      FIELDS.map((f) => [f.key, sum(list.map((r) => Number(r.totals[f.key]) || 0))])
    );
    $("#summary").innerHTML = list.length
      ? summaryTable(totals)
      : `<div class="empty"><span class="big">🗒️</span>ไม่มีข้อมูลในช่วงนี้</div>`;
    $("#recCount").textContent = list.length ? `(${list.length} รายการ)` : "";

    const box = $("#recordList");
    box.innerHTML = "";
    list.forEach((r) => {
      const total = sum(Object.values(r.totals).map(Number));
      const el = document.createElement("article");
      el.className = "record";
      const tags = FIELDS.filter((f) => Number(r.totals[f.key]) > 0)
        .map((f) => {
          const d = r.details && r.details[f.key];
          const title = d && d.length > 1 ? ` title="${d.join(" + ")}"` : "";
          return `<span class="tag" style="--mc:${f.mat.color}"${title}>${f.short} <b>${fmt(r.totals[f.key])}</b></span>`;
        })
        .join("");
      el.innerHTML = `
        <div class="record-head">
          <div>
            <div class="record-who">👤 ${r.employee}</div>
            <div class="record-time">${new Date(r.ts).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</div>
          </div>
          <div class="record-total">${fmt(total)} แผ่น</div>
        </div>
        <div class="record-items">${tags}</div>
        <div class="record-foot">
          <span class="badge ${r.synced ? "" : "pending"}">${r.synced ? (API ? "☁️ บันทึกลงชีตแล้ว" : "💾 บันทึกในเครื่อง") : "⏳ รอส่งขึ้นชีต"}</span>
          <button class="btn small danger" type="button">ลบ</button>
        </div>`;
      $(".btn.danger", el).addEventListener("click", () => deleteRecord(r));
      box.appendChild(el);
    });
  }

  async function deleteRecord(r) {
    if (!confirm(`ลบรายการของ ${r.employee} (${new Date(r.ts).toLocaleString("th-TH")}) ?`)) return;
    if (API && r.synced) {
      try {
        await apiPost({ action: "delete", id: r.id });
      } catch {
        toast("ลบไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
        return;
      }
    }
    records = records.filter((x) => x.id !== r.id);
    save(LS.records, records);
    renderHistory();
    toast("ลบแล้ว");
  }

  function initFilters() {
    const sel = $("#fEmp");
    sel.innerHTML = `<option value="">ทุกคน</option>` +
      CFG.EMPLOYEES.map((e) => `<option>${e}</option>`).join("");
    ["#fFrom", "#fTo", "#fEmp"].forEach((s) =>
      $(s).addEventListener("change", () => {
        $$(".pill").forEach((p) => p.classList.remove("active"));
        renderHistory();
      })
    );
    $$(".pill").forEach((p) => p.addEventListener("click", () => setRange(p.dataset.range)));
    $("#btnRefresh").addEventListener("click", async () => {
      if (!API) {
        renderHistory();
        return;
      }
      await pushPending();
      await pullRemote(true);
    });
    $("#btnExport").addEventListener("click", exportCsv);
    setRange("today");
  }

  function exportCsv() {
    const list = filteredRecords().slice().reverse();
    if (!list.length) {
      toast("ไม่มีข้อมูลให้ส่งออก");
      return;
    }
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["Timestamp", "พนักงาน", ...FIELDS.map((f) => f.label), "รายละเอียด"];
    const rows = list.map((r) => [
      new Date(r.ts).toLocaleString("en-GB"),
      r.employee,
      ...FIELDS.map((f) => r.totals[f.key] || 0),
      FIELDS.filter((f) => r.details && r.details[f.key] && r.details[f.key].length)
        .map((f) => `${f.short}: ${r.details[f.key].join("+")}`)
        .join(" | "),
    ]);
    const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `มิเตอร์การพิมพ์_${$("#fFrom").value || "all"}_${$("#fTo").value || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------------- Google Sheet sync ----------------
  function setStatus(text, cls) {
    const el = $("#syncStatus");
    el.textContent = text;
    el.className = "sub " + (cls || "");
  }

  async function apiPost(body) {
    // text/plain เพื่อเลี่ยง CORS preflight ของ Apps Script
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
      });
    } catch {
      if (!navigator.onLine) throw new Error("ไม่มีอินเทอร์เน็ต");
      // มีเน็ตแต่ fetch ล้ม = ส่วนใหญ่ Google เด้งไปหน้าล็อกอิน (สิทธิ์ไม่ใช่ "ทุกคน")
      throw new Error('Google Script ไม่ยอมรับ ให้ตั้ง "ผู้มีสิทธิ์เข้าถึง" เป็น "ทุกคน" แล้ว Deploy เวอร์ชันใหม่');
    }
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Google Script ตอบกลับผิดรูปแบบ (HTTP ${res.status}) ลอง Deploy เวอร์ชันใหม่`);
    }
    if (!data.ok) throw new Error(`สคริปต์แจ้งว่า: ${data.error || "ไม่ทราบสาเหตุ"}`);
    return data;
  }

  async function pushPending() {
    if (!API_OK) return;
    const pending = records.filter((r) => !r.synced);
    if (!pending.length) {
      setStatus("เชื่อมต่อ Google Sheet แล้ว", "ok");
      return;
    }
    setStatus(`กำลังส่ง ${pending.length} รายการ…`);
    let lastError = "";
    for (const r of pending) {
      try {
        const { synced, ...payload } = r;
        await apiPost({ action: "add", record: payload });
        r.synced = true;
        save(LS.records, records);
      } catch (err) {
        lastError = err.message;
        break;
      }
    }
    const left = records.filter((r) => !r.synced).length;
    if (left) setStatus(`ค้างส่ง ${left} รายการ · ${lastError}`, "warn");
    else setStatus("เชื่อมต่อ Google Sheet แล้ว", "ok");
    if (!$("#view-history").hidden) renderHistory();
  }

  async function pullRemote(showToast) {
    if (!API_OK) return;
    try {
      const res = await fetch(`${API}?action=list`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const pending = records.filter((r) => !r.synced);
      const remote = data.records.map((r) => ({ ...r, synced: true }));
      const ids = new Set(remote.map((r) => r.id));
      records = [...pending.filter((r) => !ids.has(r.id)), ...remote];
      save(LS.records, records);
      if (!$("#view-history").hidden) renderHistory();
      if (showToast) toast("อัปเดตข้อมูลล่าสุดแล้ว");
    } catch {
      if (showToast) toast("โหลดข้อมูลจากชีตไม่สำเร็จ");
    }
  }

  // ---------------- init ----------------
  renderEmployees();
  renderMaterials();
  initFilters();
  if (API && !API_OK) {
    // ลิงก์ผิดรูปแบบ (เช่น ลิงก์ googleusercontent ที่ได้หลังเปิด /exec ในเบราว์เซอร์)
    setStatus("ลิงก์ Google Sheet ใน config.js ไม่ถูกต้อง ต้องขึ้นต้น script.google.com และลงท้าย /exec", "warn");
  } else if (API) {
    setStatus("กำลังเชื่อมต่อ Google Sheet…");
    pushPending();
    window.addEventListener("online", pushPending);
  } else {
    setStatus("บันทึกในเครื่องนี้ (ยังไม่ได้เชื่อม Google Sheet)", "warn");
  }
})();
