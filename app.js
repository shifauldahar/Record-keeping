// =========================
// FIREBASE (Firestore realtime) - Debug Build
// =========================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  collection, doc, setDoc, getDocs,
  onSnapshot, query, orderBy,
  runTransaction, writeBatch,
  serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ✅ Your Firebase config (ok)
const firebaseConfig = {
  apiKey: "AIzaSyBlwnPL3ssSVaY8firV9R-moXoJMT4UhVk",
  authDomain: "recordkeeping-35260.firebaseapp.com",
  projectId: "recordkeeping-35260",
  storageBucket: "recordkeeping-35260.firebasestorage.app",
  messagingSenderId: "872390061997",
  appId: "1:872390061997:web:4a8cce855e09f009a77b24",
  measurementId: "G-VL4TDJJ79L"
};

const LOGO_URL = "https://raw.githubusercontent.com/shifauldahar/Record-keeping/b3a3663fe8ce92d63a3275c7395433a387d9230e/logo1.png";

// =========================
// Global Crash Catchers (VERY IMPORTANT)
// =========================
window.addEventListener("error", (e) => {
  const msg = `JS Error:
${e.message}
File: ${e.filename || "?"}:${e.lineno || "?"}:${e.colno || "?"}`;
  console.error(e.error || e);
  safeToast(msg, false, 9000);
});

window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason?.message || String(e.reason || "Unknown rejection");
  const msg = `Promise Error:
${reason}`;
  console.error(e.reason || e);
  safeToast(msg, false, 9000);
});

// =========================
// UI Helpers
// =========================
function safeToast(msg, ok = true, ms = 3500) {
  const t = document.getElementById("toast");
  if (!t) { alert(msg); return; }
  t.className = "toast show " + (ok ? "ok" : "bad");
  t.textContent = msg;
  setTimeout(() => { t.className = "toast"; }, ms);
}

function toast(msg, ok = true) {
  safeToast(msg, ok, 3500);
}

function setConn(status, ok) {
  const b = document.getElementById("connBadge");
  if (!b) return;
  b.textContent = status;
  b.style.borderColor = ok ? "rgba(57,217,138,.35)" : "rgba(255,92,92,.35)";
}

function pad3(n) {
  const s = String(n ?? "").trim();
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

function explainFirestoreError(err) {
  const code = err?.code || "";
  const msg = err?.message || String(err || "Unknown error");

  // Most common problems
  if (code === "permission-denied") {
    return `PERMISSION DENIED (Firestore Rules)
Fix:
1) Firebase Console → Firestore Database → Rules
2) For testing, allow read/write temporarily:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}

Then publish rules.`;
  }

  if (code === "failed-precondition" && msg.toLowerCase().includes("index")) {
    return `MISSING INDEX (Firestore)
Fix:
Open the error details in Console (F12) → it contains a link "create index".
Click it → Create index → wait → refresh site.`;
  }

  if (code === "unavailable") {
    return `Firestore UNAVAILABLE (network / blocked)
Fix:
1) Check internet
2) Try another browser
3) Disable adblock/VPN
4) Ensure site is HTTPS (GitHub pages is ok).`;
  }

  return `Firestore Error:
${code ? `Code: ${code}\n` : ""}${msg}`;
}

// =========================
// Firebase Init
// =========================
let app, db;
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (err) {
  setConn("Firebase init failed ❌", false);
  safeToast("Firebase init failed:\n" + (err?.message || err), false, 12000);
  throw err;
}

// =========================
// State
// =========================
let state = { medicines: [], customers: [], sales: [] };
let currentSaleItems = [];
let connectedOnce = false;

// =========================
// DOM refs (ensure exist)
// =========================
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element id="${id}" in HTML`);
  return el;
}

// Medicine refs
const el_mSearchId = $("mSearchId");
const el_mId = $("mId");
const el_mName = $("mName");
const el_mAddQty = $("mAddQty");
const el_mAvail = $("mAvail");
const el_mTotal = $("mTotal");
const el_mNote = $("mNote");

// Customer refs
const el_cName = $("cName");
const el_cMobile = $("cMobile");
const el_cAddress = $("cAddress");

// Sales refs
const el_sCustomer = $("sCustomer");
const el_sMobile = $("sMobile");
const el_sAddress = $("sAddress");
const el_sNote = $("sNote");
const el_sMedSelect = $("sMedSelect");
const el_sQty = $("sQty");

// =========================
// Helpers
// =========================
function findMedicineById(id) {
  id = pad3(id);
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

function resetMedicineFormToNew() {
  el_mId.value = nextMedicineId() || "001";
  el_mName.value = "";
  el_mAddQty.value = "";
  el_mAvail.value = "0";
  el_mTotal.value = "0";
  el_mNote.value = "";
  el_mSearchId.value = "";
  $("nextIdPill").textContent = "Next ID: " + el_mId.value;
}

function fillMedicineForm(m) {
  el_mId.value = m.id;
  el_mName.value = m.name || "";
  el_mAvail.value = String(Number(m.availableQty || 0));
  el_mTotal.value = String(Number(m.totalQty || 0));
  el_mNote.value = m.note || "";
  el_mAddQty.value = "";
  $("nextIdPill").textContent = "Loaded ID: " + m.id;
}

// =========================
// Tabs
// =========================
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  t.classList.add("active");

  const tab = t.dataset.tab;
  document.querySelectorAll(".tabpane").forEach(p => p.style.display = "none");
  const pane = document.getElementById("tab-" + tab);
  if (pane) pane.style.display = "block";
}));

// =========================
// Realtime listeners (with detailed errors)
// =========================
function startRealtime() {
  setConn("Connecting…", true);

  // ✅ medicines: orderBy("id") requires each doc has field "id" (we set it in save)
  onSnapshot(
    query(collection(db, "medicines"), orderBy("id", "asc")),
    (snap) => {
      state.medicines = snap.docs.map(d => {
        const data = d.data();
        // ensure id field exists for sorting
        return { ...data, id: data.id || d.id };
      });
      renderMedicines();
      renderSalesMedicineDropdown();
      if (!connectedOnce) finishConnected("medicines");
    },
    (err) => realtimeFail("medicines", err)
  );

  // ✅ customers: orderBy("mobile") requires field "mobile" too
  onSnapshot(
    query(collection(db, "customers"), orderBy("mobile", "asc")),
    (snap) => {
      state.customers = snap.docs.map(d => {
        const data = d.data();
        return { ...data, mobile: data.mobile || d.id };
      });
      renderCustomers();
      renderCustomerDatalist();
      if (!connectedOnce) finishConnected("customers");
    },
    (err) => realtimeFail("customers", err)
  );

  // ✅ sales: orderBy("createdAt") - if old docs missing createdAt -> query fails
  // FIX: we keep createdAt always when adding, but if you already have old docs, it can fail.
  // Solution: fallback query orderBy("date") if createdAt fails.
  trySalesListenerPrimary();
}

function trySalesListenerPrimary() {
  onSnapshot(
    query(collection(db, "sales"), orderBy("createdAt", "desc")),
    (snap) => {
      state.sales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSalesHistory();
      if (!connectedOnce) finishConnected("sales");
    },
    (err) => {
      // If index/createdAt missing => fallback
      console.warn("Sales primary listener failed, trying fallback:", err);
      safeToast("Sales listener issue. Trying fallback...\n" + explainFirestoreError(err), false, 7000);
      trySalesListenerFallback();
    }
  );
}

function trySalesListenerFallback() {
  onSnapshot(
    query(collection(db, "sales"), orderBy("date", "desc")),
    (snap) => {
      state.sales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSalesHistory();
      if (!connectedOnce) finishConnected("sales");
      safeToast("Sales fallback active (ordered by date). If you want createdAt, create index / ensure field exists.", true, 6000);
    },
    (err) => realtimeFail("sales(fallback)", err)
  );
}

function realtimeFail(name, err) {
  console.error(`Realtime error [${name}]`, err);
  setConn("Disconnected ❌", false);
  safeToast(`Realtime failed: ${name}\n\n${explainFirestoreError(err)}`, false, 12000);
}

function finishConnected(sourceName) {
  connectedOnce = true;
  setConn("Connected ✅", true);
  toast(`Connected ✅ (listener: ${sourceName})`, true);
  if (!el_mId.value) resetMedicineFormToNew();
  renderAll();
}

// =========================
// Button actions - Medicines
// =========================
$("btnNewMedicine").addEventListener("click", () => {
  try { resetMedicineFormToNew(); }
  catch (e) { safeToast("btnNewMedicine error:\n" + e.message, false, 9000); }
});

$("btnSearchMedicine").addEventListener("click", () => {
  try {
    const id = pad3((el_mSearchId.value || "").trim());
    if (!id) throw new Error("Enter Record ID (e.g. 001).");
    const m = findMedicineById(id);
    if (!m) throw new Error("No medicine found for ID " + id);
    fillMedicineForm(m);
  } catch (e) {
    safeToast("Search failed:\n" + e.message, false, 8000);
  }
});

$("btnSaveMedicine").addEventListener("click", async () => {
  try {
    // 1) Read + validate inputs
    const currentIdRaw = (el_mId.value || "").trim();
    const id = pad3(currentIdRaw);
    const name = (el_mName.value || "").trim();
    const addQty = parseInt(el_mAddQty.value, 10) || 0;
    const note = (el_mNote.value || "").trim();

    if (!id) throw new Error("Record ID missing.");
    if (!name) throw new Error("Medicine name is required.");
    if (addQty < 0) throw new Error("Quantity cannot be negative.");

    const ref = doc(db, "medicines", id);

    // 2) Save in transaction (create or update)
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);

      if (!snap.exists()) {
        if (addQty <= 0) throw new Error("For new medicine, add some qty (>0).");

        tx.set(ref, {
          id,                 // keep for orderBy("id")
          name,
          note,
          totalQty: addQty,
          availableQty: addQty,
          updatedAt: serverTimestamp(),
        });
      } else {
        const updates = {
          id,
          name,
          note,
          updatedAt: serverTimestamp(),
        };

        if (addQty > 0) {
          updates.totalQty = increment(addQty);
          updates.availableQty = increment(addQty);
        }

        tx.update(ref, updates);
      }
    });

    toast("Medicine saved ✅", true);

    // 3) Auto-increment ID to next (same function, no extra helper)
    const nextNum = (parseInt(id, 10) || 0) + 1;
    const nextId = String(nextNum).padStart(3, "0");

    // 4) Reset UI for next entry
    el_mId.value = nextId;
    el_mName.value = "";
    el_mAddQty.value = "";
    el_mNote.value = "";

    // (Optional) focus cursor to medicine name for faster entry
    el_mName.focus();

  } catch (err) {
    console.error(err);
    safeToast("Save Medicine failed:\n" + explainFirestoreError(err), false, 12000);
  }
});


// =========================
// Customers
// =========================
$("btnSaveCustomer").addEventListener("click", async () => {
  try {
    const name = el_cName.value.trim();
    const mobile = el_cMobile.value.trim();
    const address = el_cAddress.value.trim();

    if (!name) throw new Error("Customer name required.");
    if (!mobile) throw new Error("Mobile number required.");

    // IMPORTANT: include mobile field for orderBy("mobile")
    await setDoc(doc(db, "customers", mobile), {
      name, mobile, address,
      updatedAt: serverTimestamp()
    }, { merge: true });

    el_cName.value = ""; el_cMobile.value = ""; el_cAddress.value = "";
    toast("Customer saved ✅", true);

  } catch (err) {
    console.error(err);
    safeToast("Save Customer failed:\n" + explainFirestoreError(err), false, 12000);
  }
});

$("btnResetCustomer").addEventListener("click", () => {
  try {
    el_cName.value = ""; el_cMobile.value = ""; el_cAddress.value = "";
  } catch (e) {
    safeToast("Reset customer error:\n" + e.message, false, 8000);
  }
});

// =========================
// Sales
// =========================
function syncCustomerByName() {
  try {
    const name = el_sCustomer.value.trim();
    if (!name) return;
    const c = state.customers.find(x => (x.name || "").toLowerCase() === name.toLowerCase());
    if (c) {
      el_sMobile.value = c.mobile || "";
      el_sAddress.value = c.address || "";
    }
  } catch (e) {
    safeToast("syncCustomerByName error:\n" + e.message, false, 8000);
  }
}
el_sCustomer.addEventListener("change", syncCustomerByName);
el_sCustomer.addEventListener("blur", syncCustomerByName);

$("btnAddSaleItem").addEventListener("click", () => {
  try {
    const medId = el_sMedSelect.value;
    if (!medId) throw new Error("Select a medicine.");

    const qty = parseInt(el_sQty.value, 10);
    if (!qty || qty <= 0) throw new Error("Enter quantity (>= 1).");

    const m = findMedicineById(medId);
    if (!m) throw new Error("Medicine not found.");

    const already = currentSaleItems.find(i => i.medId === medId);
    const totalWanted = (already ? already.qty : 0) + qty;

    if (totalWanted > Number(m.availableQty || 0)) {
      throw new Error(`Not enough stock. Available: ${Number(m.availableQty || 0)}`);
    }

    if (already) already.qty += qty;
    else currentSaleItems.push({ medId, medName: m.name, qty });

    el_sQty.value = "";
    renderCurrentSaleItems();

  } catch (e) {
    safeToast("Add item failed:\n" + e.message, false, 9000);
  }
});

$("btnResetSale").addEventListener("click", () => {
  try {
    currentSaleItems = [];
    el_sCustomer.value = "";
    el_sMobile.value = "";
    el_sAddress.value = "";
    el_sNote.value = "";
    el_sQty.value = "";
    renderCurrentSaleItems();
  } catch (e) {
    safeToast("Reset sale error:\n" + e.message, false, 9000);
  }
});

$("btnFinalizeSale").addEventListener("click", async () => {
  try {
    const customer = el_sCustomer.value.trim();
    const mobile = el_sMobile.value.trim();
    const address = el_sAddress.value.trim();
    const note = el_sNote.value.trim();

    if (!customer) throw new Error("Customer name required.");
    if (!mobile) throw new Error("Mobile required.");
    if (currentSaleItems.length === 0) throw new Error("Add at least one item.");

    const salePayload = {
      date: nowStr(),
      customer,
      mobile,
      address,
      note,
      items: currentSaleItems.map(i => ({ medId: pad3(i.medId), medName: i.medName, qty: i.qty }))
    };

    await runTransaction(db, async (tx) => {
      // validate
      for (const it of salePayload.items) {
        const mref = doc(db, "medicines", pad3(it.medId));
        const msnap = await tx.get(mref);
        if (!msnap.exists()) throw new Error("Medicine missing: " + it.medId);
        const m = msnap.data();
        const avail = Number(m.availableQty || 0);
        const qty = Number(it.qty || 0);
        if (qty <= 0) throw new Error("Invalid qty for " + it.medName);
        if (qty > avail) throw new Error(`Not enough stock for ${m.name} (ID ${it.medId}). Available: ${avail}`);
      }

      // deduct
      for (const it of salePayload.items) {
        const mref = doc(db, "medicines", pad3(it.medId));
        tx.update(mref, { availableQty: increment(-Number(it.qty || 0)), updatedAt: serverTimestamp() });
      }

      // upsert customer
      const cref = doc(db, "customers", mobile);
      tx.set(cref, { name: customer, mobile, address, updatedAt: serverTimestamp() }, { merge: true });

      // add sale
      const sref = doc(collection(db, "sales"));
      tx.set(sref, { ...salePayload, createdAt: serverTimestamp() });
    });

    currentSaleItems = [];
    el_sNote.value = "";
    el_sQty.value = "";
    renderCurrentSaleItems();
    toast("Sale saved + stock updated ✅", true);

    logToSheetInBackground(salePayload);

  } catch (err) {
    console.error(err);
    safeToast("Finalize sale failed:\n" + explainFirestoreError(err), false, 12000);
  }
});

// =========================
// Renderers
// =========================
function renderMedicines() {
  const tbody = document.querySelector("#medTable tbody");
  tbody.innerHTML = "";
  const meds = [...state.medicines].sort((a, b) => (a.id || "").localeCompare(b.id || ""));

  for (const m of meds) {
    const tr = document.createElement("tr");
    const status = Number(m.availableQty || 0) > 0
      ? `<span class="pill status-ok">In Stock</span>`
      : `<span class="pill status-bad">Out</span>`;

    tr.innerHTML = `
      <td><b>${escapeHtml(m.id)}</b></td>
      <td>${escapeHtml(m.name || "")}
        <div style="color:rgba(234,243,241,.6);font-size:12px;margin-top:4px">${escapeHtml(m.note||"")}</div>
      </td>
      <td>${Number(m.totalQty || 0)}</td>
      <td>${Number(m.availableQty || 0)}</td>
      <td>${status}</td>
    `;
    tbody.appendChild(tr);
  }

  $("medCountPill").textContent = meds.length + " items";
  $("nextIdPill").textContent =
    (findMedicineById(el_mId.value) ? "Loaded ID: " : "Next ID: ") + el_mId.value;

  const loaded = findMedicineById(el_mId.value);
  if (loaded) {
    el_mAvail.value = String(Number(loaded.availableQty || 0));
    el_mTotal.value = String(Number(loaded.totalQty || 0));
  }
}

function renderCustomers() {
  const tbody = document.querySelector("#custTable tbody");
  tbody.innerHTML = "";
  const cust = [...state.customers].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  cust.forEach((c, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${escapeHtml(c.name || "")}</td>
      <td>${escapeHtml(c.mobile || "")}</td>
      <td>${escapeHtml(c.address || "")}</td>
    `;
    tbody.appendChild(tr);
  });

  $("custCountPill").textContent = cust.length + " customers";
}

function renderCustomerDatalist() {
  const dl = document.getElementById("customerList");
  dl.innerHTML = "";
  for (const c of state.customers) {
    const opt = document.createElement("option");
    opt.value = c.name || "";
    dl.appendChild(opt);
  }
}

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

  $("saleItemsPill").textContent = currentSaleItems.length + " items";

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

  for (const s of state.sales) {
    const itemsText = (s.items || []).map(i => `${i.medName} × ${i.qty}`).join(", ");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.date || "")}</td>
      <td>${escapeHtml(s.customer || "")}</td>
      <td>${escapeHtml(s.mobile || "")}</td>
      <td>${escapeHtml(itemsText)}</td>
      <td>${escapeHtml(s.note || "")}</td>
    `;
    tbody.appendChild(tr);
  }

  $("saleCountPill").textContent = state.sales.length + " sales";
}

// =========================
// Print
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
    display:flex; gap:12px; align-items:center;
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
    <img src="https://raw.githubusercontent.com/shifauldahar/Record-keeping/b3a3663fe8ce92d63a3275c7395433a387d9230e/logo1.png" alt="Logo" onerror="this.style.display='none'"/>
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

$("btnPrintMedicine").addEventListener("click", () => {
  try {
    const printArea = document.getElementById("medicinePrintArea");
    const html = printArea ? printArea.innerHTML : "<p>No data to print</p>";
    openPrintWindow({
      title: "Medicines Sheet",
      headerTitle: "SHIFA-UL-DAHAR — Medicines Sheet",
      headerSubtitle: "Rohani u Jasmani Ilaj Gah",
      extraMetaHtml: "",
      bodyHtml: html
    });
  } catch (e) {
    safeToast("Print medicine error:\n" + e.message, false, 9000);
  }
});

$("btnPrintSales").addEventListener("click", () => {
  try {
    const printArea = document.getElementById("salesPrintArea");
    const html = printArea ? printArea.innerHTML : "<p>No sales to print</p>";
    openPrintWindow({
      title: "Sales Sheet",
      headerTitle: "SHIFA-UL-DAHAR — Sales Sheet",
      headerSubtitle: "Rohani u Jasmani Ilaj Gah",
      extraMetaHtml: "This print includes Sales History (with Notes).",
      bodyHtml: html
    });
  } catch (e) {
    safeToast("Print sales error:\n" + e.message, false, 9000);
  }
});

// =========================
// Export Excel
// =========================
$("btnExport").addEventListener("click", () => {
  try {
    if (!window.XLSX) throw new Error("XLSX library not loaded (check internet).");

    const meds = [...state.medicines].sort((a, b) => (a.id || "").localeCompare(b.id || "")).map(m => ({
      ID: m.id,
      Medicine: m.name || "",
      TotalAdded: Number(m.totalQty || 0),
      Available: Number(m.availableQty || 0),
      Note: m.note || ""
    }));

    const cust = [...state.customers].sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(c => ({
      Name: c.name || "",
      Mobile: c.mobile || "",
      Address: c.address || ""
    }));

    const salesRows = [];
    for (const s of state.sales) {
      for (const it of (s.items || [])) {
        salesRows.push({
          Date: s.date || "",
          Customer: s.customer || "",
          Mobile: s.mobile || "",
          Address: s.address || "",
          Notes: s.note || "",
          MedicineID: it.medId || "",
          Medicine: it.medName || "",
          Qty: it.qty || 0
        });
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meds), "Medicines");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cust), "Customers");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesRows), "Sales");
    XLSX.writeFile(wb, "Shifa-ul-Dahar_Records.xlsx");

    toast("Excel exported ✅", true);
  } catch (e) {
    safeToast("Export failed:\n" + e.message, false, 10000);
  }
});

// =========================
// Clear All (batch delete)
// =========================
$("btnClearAll").addEventListener("click", async () => {
  if (!confirm("This will delete ALL medicines, customers and sales. Continue?")) return;
  try {
    await deleteCollectionAll("sales");
    await deleteCollectionAll("customers");
    await deleteCollectionAll("medicines");
    currentSaleItems = [];
    resetMedicineFormToNew();
    renderAll();
    toast("All data cleared ✅", true);
  } catch (err) {
    console.error(err);
    safeToast("Clear failed:\n" + explainFirestoreError(err), false, 12000);
  }
});

async function deleteCollectionAll(colName) {
  const colRef = collection(db, colName);
  const snap = await getDocs(colRef);
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

// =========================
// Debug button (quick check)
// =========================
$("btnDebug").addEventListener("click", async () => {
  try {
    const lines = [];
    lines.push("DEBUG INFO");
    lines.push("Project: " + firebaseConfig.projectId);
    lines.push("Medicines loaded: " + state.medicines.length);
    lines.push("Customers loaded: " + state.customers.length);
    lines.push("Sales loaded: " + state.sales.length);
    lines.push("URL: " + location.href);
    toast(lines.join("\n"), true);
  } catch (e) {
    safeToast("Debug failed:\n" + e.message, false, 10000);
  }
});

// =========================
// Background Sheets logger (optional)
// =========================
function logToSheetInBackground(salePayload) {
  if (!SHEET_LOGGER_URL) return;
  fetch(SHEET_LOGGER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shifa-secret": SHEET_LOGGER_SECRET || ""
    },
    body: JSON.stringify({ type: "sale", sale: salePayload })
  }).catch((e) => {
    console.warn("Sheet logger failed (ignored):", e);
  });
}

// =========================
// Render All
// =========================
function renderAll() {
  renderMedicines();
  renderCustomers();
  renderCustomerDatalist();
  renderSalesMedicineDropdown();
  renderSalesHistory();
  renderCurrentSaleItems();
  if (!el_mId.value) resetMedicineFormToNew();
}

// =========================
// INIT
// =========================
resetMedicineFormToNew();
renderAll();
startRealtime();
