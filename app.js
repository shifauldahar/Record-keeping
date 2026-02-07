// =========================
// CONFIG
// =========================
const API_URL = "https://script.google.com/macros/s/AKfycbzZ0kNIr7uVLh3u_S6JV8dgAlsd-Q04CrHunD2VMir95jUgkWqxJtlm4epP4T1iZ32B8Q/exec";

// ✅ Put your PNG logo in same folder as index.html OR change this path
const LOGO_URL = "./https://raw.githubusercontent.com/shifauldahar/Record-keeping/d13c6c6b14fd25fe6133f6379339751e20059d64/logo1.png
";

// =========================
// UI Helpers
// =========================
function toast(msg, ok = true) {
  const t = document.getElementById("toast");
  t.className = "toast show " + (ok ? "ok" : "bad");
  t.textContent = msg;
  setTimeout(() => { t.className = "toast"; }, 3000);
}

function setConn(status, ok) {
  const b = document.getElementById("connBadge");
  b.textContent = status;
  b.style.borderColor = ok ? "rgba(57,217,138,.35)" : "rgba(255,92,92,.35)";
}

// =========================
// Safe JSON
// =========================
async function readJsonSafe(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error("Server did not return JSON. Got:\n" + text.slice(0, 250)); }
}

// =========================
// API calls
// =========================
async function apiGetAll() {
  const res = await fetch(API_URL + "?action=getAll&t=" + Date.now(), {
    cache: "no-store",
    credentials: "omit"
  });
  const j = await readJsonSafe(res);
  if (!j.ok) throw new Error(j.error || "Failed getAll");
  return j.state;
}

async function apiPost(action, payload) {
  const bodyObj = { action, ...payload };
  const body = "payload=" + encodeURIComponent(JSON.stringify(bodyObj));

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body
  });

  const j = await readJsonSafe(res);
  if (!j.ok) throw new Error(j.error || ("Failed: " + action));
  return j;
}

// =========================
// State + Helpers
// =========================
let state = { medicines: [], customers: [], sales: [] };
let currentSaleItems = [];

function pad3(n) {
  const s = String(n ?? "");
  if (!s) return "";
  return s.length >= 3 ? s : ("000" + s).slice(-3);
}

function nowStr() {
  const d = new Date();
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function findMedicineById(id) {
  id = pad3((id || "").trim());
  return state.medicines.find(m => m.id === id);
}

function nextMedicineId() {
  let max = 0;
  for (const m of state.medicines) {
    const n = parseInt(m.id, 10);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return pad3(max + 1);
}

async function syncFromSheet() {
  state = await apiGetAll();
}

// =========================
// Tabs
// =========================
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  t.classList.add("active");

  const tab = t.dataset.tab;
  document.querySelectorAll(".tabpane").forEach(p => p.style.display = "none");
  document.getElementById("tab-" + tab).style.display = "block";
}));

// =========================
// Medicines UI
// =========================
const el_mSearchId = document.getElementById("mSearchId");
const el_mId = document.getElementById("mId");
const el_mName = document.getElementById("mName");
const el_mAddQty = document.getElementById("mAddQty");
const el_mAvail = document.getElementById("mAvail");
const el_mTotal = document.getElementById("mTotal");
const el_mNote = document.getElementById("mNote");

function resetMedicineFormToNew() {
  el_mId.value = nextMedicineId();
  el_mName.value = "";
  el_mAddQty.value = "";
  el_mAvail.value = "0";
  el_mTotal.value = "0";
  el_mNote.value = "";
  el_mSearchId.value = "";
  document.getElementById("nextIdPill").textContent = "Next ID: " + el_mId.value;
}

function fillMedicineForm(m) {
  el_mId.value = m.id;
  el_mName.value = m.name;
  el_mAvail.value = String(Number(m.availableQty || 0));
  el_mTotal.value = String(Number(m.totalQty || 0));
  el_mNote.value = m.note || "";
  el_mAddQty.value = "";
  document.getElementById("nextIdPill").textContent = "Loaded ID: " + m.id;
}

document.getElementById("btnNewMedicine").addEventListener("click", resetMedicineFormToNew);

document.getElementById("btnSearchMedicine").addEventListener("click", () => {
  const id = pad3((el_mSearchId.value || "").trim());
  if (!id) return alert("Enter Record ID (e.g. 001).");
  const m = findMedicineById(id);
  if (!m) return alert("No medicine found for ID " + id);
  fillMedicineForm(m);
});

document.getElementById("btnSaveMedicine").addEventListener("click", async () => {
  try {
    const id = pad3(el_mId.value.trim());
    const name = el_mName.value.trim();
    const addQty = parseInt(el_mAddQty.value, 10) || 0;
    const note = el_mNote.value.trim();

    if (!id) return alert("Record ID missing.");
    if (!name) return alert("Medicine name is required.");
    if (addQty < 0) return alert("Quantity cannot be negative.");

    let m = findMedicineById(id);

    if (!m) {
      if (addQty <= 0) return alert("For new medicine, add some qty (>0).");
      m = { id, name, totalQty: 0, availableQty: 0, note: "" };
      state.medicines.push(m);
    } else {
      m.name = name;
    }

    if (addQty > 0) {
      m.totalQty = Number(m.totalQty || 0) + addQty;
      m.availableQty = Number(m.availableQty || 0) + addQty;
    }
    m.note = note;

    await apiPost("upsertMedicine", { medicine: m });
    await syncFromSheet();
    renderAll();

    const refreshed = findMedicineById(id);
    if (refreshed) fillMedicineForm(refreshed);

    toast("Medicine saved ✅", true);
  } catch (err) {
    alert("Save failed: " + err.message);
    toast("Save failed ❌\n" + err.message, false);
  }
});

// =========================
// PRINT Helpers (shared)
// =========================
function openPrintWindow({ title, headerTitle, headerSubtitle, extraMetaHtml, bodyHtml }) {
  const w = window.open("", "_blank", "width=980,height=720");
  w.document.open();
  w.document.write(`
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body{ font-family: Arial, sans-serif; padding: 20px; color:#000; }
  .header{
    display:flex;
    gap:12px;
    align-items:center;
    border-bottom:2px solid #ddd;
    padding-bottom:12px;
    margin-bottom:14px;
  }
  .header img{ height:64px; width:auto; object-fit:contain; }
  .header h1{ margin:0; font-size:18px; letter-spacing:.3px; }
  .header small{ display:block; margin-top:4px; color:#444; font-weight:600; }
  .meta{ margin: 8px 0 14px 0; font-size:12px; color:#333; }
  table{ width:100%; border-collapse:collapse; font-size:13px; }
  th, td{ padding:10px; border:1px solid #ddd; text-align:left; vertical-align:top; }
  th{ background:#f5f5f5; font-weight:700; }
</style>
</head>
<body>
  <div class="header">
    <img src="${LOGO_URL}" alt="Logo" onerror="this.style.display='none'"/>
    <div>
      <h1>${escapeHtml(headerTitle)}</h1>
      <small>${escapeHtml(headerSubtitle)}</small>
    </div>
  </div>

  <div class="meta">
    Printed on: ${new Date().toLocaleString()}
    ${extraMetaHtml ? "<br/>" + extraMetaHtml : ""}
  </div>

  ${bodyHtml}

  <script>
    window.onload = function(){ window.print(); };
  <\/script>
</body>
</html>
  `);
  w.document.close();
}

// Print Medicines
document.getElementById("btnPrintMedicine").addEventListener("click", () => {
  const printArea = document.getElementById("medicinePrintArea");
  const html = printArea ? printArea.innerHTML : "<p>No data to print</p>";

  openPrintWindow({
    title: "Medicines Sheet",
    headerTitle: "SHIFA-UL-DAHAR — Medicines Sheet",
    headerSubtitle: "Rohani u Jasmani Ilaj Gah",
    extraMetaHtml: "",
    bodyHtml: html
  });
});

// Render Medicines list
function renderMedicines() {
  const tbody = document.querySelector("#medTable tbody");
  tbody.innerHTML = "";
  const meds = [...state.medicines].sort((a, b) => a.id.localeCompare(b.id));

  for (const m of meds) {
    const tr = document.createElement("tr");
    const status = Number(m.availableQty) > 0
      ? `<span>In Stock</span>`
      : `<span>Out</span>`;

    tr.innerHTML = `
      <td><b>${escapeHtml(m.id)}</b></td>
      <td>${escapeHtml(m.name)}
        <div style="color:rgba(234,243,241,.6);font-size:12px;margin-top:4px">${escapeHtml(m.note||"")}</div>
      </td>
      <td>${Number(m.totalQty||0)}</td>
      <td>${Number(m.availableQty||0)}</td>
      <td>${status}</td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById("medCountPill").textContent = meds.length + " items";
  document.getElementById("nextIdPill").textContent =
    (findMedicineById(el_mId.value) ? "Loaded ID: " : "Next ID: ") + el_mId.value;

  renderSalesMedicineDropdown();
}

// =========================
// Customers UI
// =========================
const el_cName = document.getElementById("cName");
const el_cMobile = document.getElementById("cMobile");
const el_cAddress = document.getElementById("cAddress");

document.getElementById("btnSaveCustomer").addEventListener("click", async () => {
  try {
    const name = el_cName.value.trim();
    const mobile = el_cMobile.value.trim();
    const address = el_cAddress.value.trim();

    if (!name) return alert("Customer name required.");
    if (!mobile) return alert("Mobile number required.");

    await apiPost("upsertCustomer", { customer: { name, mobile, address } });
    await syncFromSheet();
    renderAll();

    el_cName.value = ""; el_cMobile.value = ""; el_cAddress.value = "";
    toast("Customer saved ✅", true);
  } catch (err) {
    alert("Customer save failed: " + err.message);
    toast("Customer save failed ❌\n" + err.message, false);
  }
});

document.getElementById("btnResetCustomer").addEventListener("click", () => {
  el_cName.value = ""; el_cMobile.value = ""; el_cAddress.value = "";
});

function renderCustomers() {
  const tbody = document.querySelector("#custTable tbody");
  tbody.innerHTML = "";
  const cust = [...state.customers].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  cust.forEach((c, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.mobile)}</td>
      <td>${escapeHtml(c.address || "")}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("custCountPill").textContent = cust.length + " customers";
  renderCustomerDatalist();
}

function renderCustomerDatalist() {
  const dl = document.getElementById("customerList");
  dl.innerHTML = "";
  for (const c of state.customers) {
    const opt = document.createElement("option");
    opt.value = c.name;
    dl.appendChild(opt);
  }
}

// =========================
// Sales UI
// =========================
const el_sCustomer = document.getElementById("sCustomer");
const el_sMobile = document.getElementById("sMobile");
const el_sAddress = document.getElementById("sAddress");
const el_sNote = document.getElementById("sNote"); // ✅ NEW
const el_sMedSelect = document.getElementById("sMedSelect");
const el_sQty = document.getElementById("sQty");

function renderSalesMedicineDropdown() {
  const meds = [...state.medicines].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  el_sMedSelect.innerHTML = "";

  if (meds.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No medicines (add in Balance Sheet)";
    el_sMedSelect.appendChild(opt);
    el_sMedSelect.disabled = true;
  } else {
    el_sMedSelect.disabled = false;
    for (const m of meds) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.name} (ID ${m.id}, Avail: ${Number(m.availableQty || 0)})`;
      el_sMedSelect.appendChild(opt);
    }
  }
}

function syncCustomerByName() {
  const name = el_sCustomer.value.trim();
  if (!name) return;
  const c = state.customers.find(x => (x.name || "").toLowerCase() === name.toLowerCase());
  if (c) {
    el_sMobile.value = c.mobile;
    el_sAddress.value = c.address || "";
  }
}
el_sCustomer.addEventListener("change", syncCustomerByName);
el_sCustomer.addEventListener("blur", syncCustomerByName);

document.getElementById("btnAddSaleItem").addEventListener("click", () => {
  const medId = el_sMedSelect.value;
  if (!medId) return alert("Select a medicine.");

  const qty = parseInt(el_sQty.value, 10);
  if (!qty || qty <= 0) return alert("Enter quantity (>= 1).");

  const m = findMedicineById(medId);
  if (!m) return alert("Medicine not found.");

  const already = currentSaleItems.find(i => i.medId === medId);
  const totalWanted = (already ? already.qty : 0) + qty;

  if (totalWanted > Number(m.availableQty || 0)) {
    return alert(`Not enough stock. Available: ${Number(m.availableQty || 0)}`);
  }

  if (already) already.qty += qty;
  else currentSaleItems.push({ medId, medName: m.name, qty });

  el_sQty.value = "";
  renderCurrentSaleItems();
});

document.getElementById("btnResetSale").addEventListener("click", () => {
  currentSaleItems = [];
  el_sCustomer.value = "";
  el_sMobile.value = "";
  el_sAddress.value = "";
  el_sNote.value = "";
  el_sQty.value = "";
  renderCurrentSaleItems();
});

document.getElementById("btnFinalizeSale").addEventListener("click", async () => {
  try {
    const customer = el_sCustomer.value.trim();
    const mobile = el_sMobile.value.trim();
    const address = el_sAddress.value.trim();
    const note = el_sNote.value.trim(); // ✅ NEW

    if (!customer) return alert("Customer name required.");
    if (!mobile) return alert("Mobile required.");
    if (currentSaleItems.length === 0) return alert("Add at least one item.");

    const sale = {
      date: nowStr(),
      customer,
      mobile,
      address,
      note, // ✅ save notes
      items: currentSaleItems.map(i => ({ medId: i.medId, medName: i.medName, qty: i.qty }))
    };

    await apiPost("upsertCustomer", { customer: { name: customer, mobile, address } });
    await apiPost("addSale", { sale });

    currentSaleItems = [];
    el_sNote.value = "";
    await syncFromSheet();
    renderAll();
    toast("Sale saved + stock updated ✅", true);
  } catch (err) {
    alert("Sale failed: " + err.message);
    toast("Sale failed ❌\n" + err.message, false);
  }
});

function renderCurrentSaleItems() {
  const tbody = document.querySelector("#saleItemsTable tbody");
  tbody.innerHTML = "";

  for (let idx = 0; idx < currentSaleItems.length; idx++) {
    const it = currentSaleItems[idx];
    const m = findMedicineById(it.medId);
    const after = m ? (Number(m.availableQty || 0) - it.qty) : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(it.medName)}
        <div style="color:rgba(234,243,241,.6);font-size:12px;margin-top:4px">ID: ${escapeHtml(it.medId)}</div>
      </td>
      <td><b>${it.qty}</b></td>
      <td>${after}</td>
      <td class="no-print"><button class="btn mini danger" data-rm="${idx}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById("saleItemsPill").textContent = currentSaleItems.length + " items";

  tbody.querySelectorAll("button[data-rm]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.rm, 10);
      currentSaleItems.splice(i, 1);
      renderCurrentSaleItems();
    });
  });
}

function renderSalesHistory() {
  const tbody = document.querySelector("#salesTable tbody");
  tbody.innerHTML = "";

  const sales = [...state.sales].slice().reverse();
  for (const s of sales) {
    const itemsText = (s.items || []).map(i => `${i.medName} × ${i.qty}`).join(", ");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.date)}</td>
      <td>${escapeHtml(s.customer)}</td>
      <td>${escapeHtml(s.mobile)}</td>
      <td>${escapeHtml(itemsText)}</td>
      <td>${escapeHtml(s.note || "")}</td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById("saleCountPill").textContent = state.sales.length + " sales";
}

// ✅ Print Sales (history table)
document.getElementById("btnPrintSales").addEventListener("click", () => {
  const printArea = document.getElementById("salesPrintArea");
  const html = printArea ? printArea.innerHTML : "<p>No sales to print</p>";

  openPrintWindow({
    title: "Sales Sheet",
    headerTitle: "SHIFA-UL-DAHAR — Sales Sheet",
    headerSubtitle: "Rohani u Jasmani Ilaj Gah",
    extraMetaHtml: "This print includes Sales History (with Notes).",
    bodyHtml: html
  });
});

// =========================
// Export Excel
// =========================
document.getElementById("btnExport").addEventListener("click", () => {
  const meds = [...state.medicines].sort((a, b) => a.id.localeCompare(b.id)).map(m => ({
    ID: m.id,
    Medicine: m.name,
    TotalAdded: Number(m.totalQty || 0),
    Available: Number(m.availableQty || 0),
    Note: m.note || ""
  }));

  const cust = [...state.customers].sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(c => ({
    Name: c.name,
    Mobile: c.mobile,
    Address: c.address || ""
  }));

  const salesRows = [];
  for (const s of state.sales) {
    for (const it of (s.items || [])) {
      salesRows.push({
        Date: s.date,
        Customer: s.customer,
        Mobile: s.mobile,
        Address: s.address || "",
        Notes: s.note || "",          // ✅ NEW
        MedicineID: it.medId,
        Medicine: it.medName,
        Qty: it.qty
      });
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meds), "Medicines");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cust), "Customers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesRows), "Sales");
  XLSX.writeFile(wb, "Shifa-ul-Dahar_Records.xlsx");
});

// =========================
// Clear All / Sync Buttons
// =========================
document.getElementById("btnClearAll").addEventListener("click", async () => {
  if (!confirm("This will delete ALL medicines, customers and sales (in Google Sheet). Continue?")) return;
  try {
    await apiPost("clearAll", {});
    await syncFromSheet();
    currentSaleItems = [];
    renderAll();
    resetMedicineFormToNew();
    toast("All data cleared ✅", true);
  } catch (err) {
    alert("Clear failed: " + err.message);
    toast("Clear failed ❌\n" + err.message, false);
  }
});

document.getElementById("btnSync").addEventListener("click", async () => {
  try {
    await syncFromSheet();
    renderAll();
    resetMedicineFormToNew();
    toast("Synced ✅", true);
  } catch (err) {
    alert("Sync failed: " + err.message);
    toast("Sync failed ❌\n" + err.message, false);
  }
});

// =========================
// Render All
// =========================
function renderAll() {
  renderMedicines();
  renderCustomers();
  renderSalesHistory();
  renderCurrentSaleItems();
  if (!el_mId.value) resetMedicineFormToNew();
}

// =========================
// INIT
// =========================
(async function init() {
  try {
    if (!API_URL || API_URL.includes("PASTE_YOUR")) {
      setConn("API URL missing ❌", false);
      toast("Paste your Apps Script /exec URL in app.js", false);
      resetMedicineFormToNew();
      renderAll();
      return;
    }

    setConn("Connecting…", true);
    await syncFromSheet();
    resetMedicineFormToNew();
    renderAll();
    setConn("Connected ✅", true);
    toast("Connected to Google Sheet ✅", true);
  } catch (err) {
    setConn("Disconnected ❌", false);
    alert(
      "Google Sheet connection failed:\n\n" + err.message +
      "\n\nIMPORTANT:\n1) Use Live Server (http://localhost)\n2) Deploy Apps Script as Web App (Anyone)\n3) Use /exec URL"
    );
    resetMedicineFormToNew();
    renderAll();
    toast("Connection failed ❌\n" + err.message, false);
  }
})();

