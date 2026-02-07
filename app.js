// =========================
// FIREBASE (Firestore realtime) + AUTH (Email/Password) — LOGIN ONLY
// =========================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  collection, doc, setDoc, getDocs,
  onSnapshot, query, orderBy,
  runTransaction, writeBatch,
  serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ✅ Firebase config
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
// GLOBAL ERROR CATCHERS
// =========================
window.addEventListener("error", (e) => {
  const msg = `JS Error:\n${e.message}\n${e.filename || "?"}:${e.lineno || "?"}:${e.colno || "?"}`;
  console.error(e.error || e);
  wowToast("Error", msg, false, 15000);
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason?.message || String(e.reason || "Unknown rejection");
  console.error(e.reason || e);
  wowToast("Promise Error", reason, false, 15000);
});

// =========================
// WOW TOAST
// =========================
let toastTimer = null;
function wowToast(title, msg, ok = true, ms = 4200) {
  const wrap = document.getElementById("toast");
  if (!wrap) { alert(title + "\n" + msg); return; }

  const tTitle = document.getElementById("toastTitle");
  const tMsg = document.getElementById("toastMsg");
  const tIcon = document.getElementById("toastIcon");
  const tBar = document.getElementById("toastBar");

  wrap.classList.remove("ok", "bad");
  wrap.classList.add(ok ? "ok" : "bad");

  tTitle.textContent = title || (ok ? "Done" : "Error");
  tMsg.textContent = msg || "";
  tIcon.textContent = ok ? "✓" : "!";

  tBar.style.animation = "none";
  void tBar.offsetWidth; // restart animation
  tBar.style.animation = "";

  wrap.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => wrap.classList.remove("show"), ms);
}

document.getElementById("toastClose")?.addEventListener("click", () => {
  document.getElementById("toast")?.classList.remove("show");
});

// =========================
// Small UI helpers
// =========================
function setConn(status, ok) {
  const b = document.getElementById("connBadge");
  if (!b) return;
  b.textContent = status;
  b.style.borderColor = ok ? "rgba(57,217,138,.35)" : "rgba(255,92,92,.35)";
}

function setAuthBadge(text, ok) {
  const b = document.getElementById("authBadge");
  if (!b) return;
  b.textContent = text;
  b.style.borderColor = ok ? "rgba(57,217,138,.35)" : "rgba(255,92,92,.35)";
}

function pad3(n) {
  const s = String(n ?? "").trim();
  if (!s) return "";
  return s.length >= 3 ? s : ("000" + s).slice(-3);
}
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nowStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function parseLocalDateFromSaleStr(s) {
  if (!s) return null;
  const t = String(s).replace(" ", "T");
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pk(n) {
  const x = Number(n || 0);
  const safe = Number.isFinite(x) ? x : 0;
  return "PKR " + safe.toLocaleString("en-PK");
}

function explainFirestoreError(err) {
  const code = err?.code || "";
  const msg = err?.message || String(err || "Unknown error");
  if (code === "permission-denied") {
    return `PERMISSION DENIED\nFix:\nFirestore Rules → allow read/write for request.auth != null`;
  }
  if (code === "failed-precondition" && msg.toLowerCase().includes("index")) {
    return `MISSING INDEX\nFix:\nConsole error → click "create index" link.`;
  }
  if (code === "unavailable") {
    return `Firestore UNAVAILABLE\nFix:\nInternet / adblock / VPN / https.`;
  }
  return `Firestore Error:\n${code ? `Code: ${code}\n` : ""}${msg}`;
}

function explainAuthError(err) {
  const code = err?.code || "";
  if (code.includes("auth/invalid-credential")) return "Invalid email or password.";
  if (code.includes("auth/user-not-found")) return "User not found (not authorized).";
  if (code.includes("auth/wrong-password")) return "Wrong password.";
  if (code.includes("auth/invalid-email")) return "Invalid email format.";
  if (code.includes("auth/too-many-requests")) return "Too many attempts. Try again later.";
  return err?.message || String(err || "Auth error");
}

// =========================
// Firebase Init
// =========================
let app, db, auth;
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
} catch (err) {
  setConn("Firebase init failed ❌", false);
  wowToast("Firebase Init Failed", err?.message || String(err), false, 12000);
  throw err;
}

// =========================
// State
// =========================
let state = { medicines: [], customers: [], sales: [] };
let currentSaleItems = [];
let connectedOnce = false;
let medicinesLoadedOnce = false;
let realtimeUnsubs = [];
let currentUser = null;

// =========================
// DOM helper
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
const el_sCharged = $("sCharged");
const el_sPayNote = $("sPayNote");
const el_sNote = $("sNote");
const el_sMedSelect = $("sMedSelect");
const el_sQty = $("sQty");

// KPI refs
const el_kpiToday = $("kpiToday");
const el_kpiMonth = $("kpiMonth");
const el_kpiAll = $("kpiAll");
const el_kpiTodayMeta = $("kpiTodayMeta");
const el_kpiMonthMeta = $("kpiMonthMeta");
const el_kpiAllMeta = $("kpiAllMeta");
const el_filterRevenuePill = $("filterRevenuePill");
const el_salesFilter = $("salesFilter");

// Auth modal refs
const authModal = $("authModal");
const authEmail = $("authEmail");
const authPass = $("authPass");

// =========================
// Helpers
// =========================
function findMedicineById(id) {
  id = pad3(id);
  return state.medicines.find(m => m.id === id);
}

function computeNextMedicineIdFromState() {
  let max = 0;
  for (const m of state.medicines) {
    const n = parseInt(m.id || m?.docId || "", 10);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return pad3(max + 1) || "001";
}

function setMedicineFormToNextFromFirebase() {
  const nextId = computeNextMedicineIdFromState();
  el_mId.value = nextId;
  el_mName.value = "";
  el_mAddQty.value = "";
  el_mAvail.value = "0";
  el_mTotal.value = "0";
  el_mNote.value = "";
  el_mSearchId.value = "";
  $("nextIdPill").textContent = "Next ID: " + nextId;
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

function clearSaleForm(keepCustomer = false) {
  currentSaleItems = [];
  if (!keepCustomer) {
    el_sCustomer.value = "";
    el_sMobile.value = "";
    el_sAddress.value = "";
  }
  el_sCharged.value = "";
  el_sPayNote.value = "";
  el_sNote.value = "";
  el_sQty.value = "";
  renderCurrentSaleItems();
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}
function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth();
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
// Live Clock
// =========================
function startLiveClock() {
  const pill = document.getElementById("liveClockPill");
  if (!pill) return;
  const tick = () => pill.textContent = "Clock: " + new Date().toLocaleString();
  tick();
  setInterval(tick, 1000);
}

// =========================
// AUTH (Login Gate) — LOGIN ONLY
// =========================
function openAuthModal() {
  authModal.classList.add("show");
  authEmail.focus();
}
function closeAuthModal() {
  authModal.classList.remove("show");
}

$("btnLoginOpen").addEventListener("click", openAuthModal);
$("btnAuthClose").addEventListener("click", closeAuthModal);
authModal.addEventListener("click", (e) => {
  if (e.target === authModal) closeAuthModal();
});

// Enter key => login
[authEmail, authPass].forEach(el => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btnAuthLogin").click();
  });
});

$("btnAuthLogin").addEventListener("click", async () => {
  try {
    const email = authEmail.value.trim();
    const pass = authPass.value;
    if (!email) throw new Error("Email required.");
    if (!pass) throw new Error("Password required.");
    await signInWithEmailAndPassword(auth, email, pass);
    wowToast("Login Success ✅", "Access granted.", true, 2500);
    closeAuthModal();
  } catch (err) {
    wowToast("Login Failed", explainAuthError(err), false, 9000);
  }
});

$("btnLogout").addEventListener("click", async () => {
  try {
    await signOut(auth);
    wowToast("Logged Out", "You have been signed out.", true, 2200);
  } catch (err) {
    wowToast("Logout Failed", explainAuthError(err), false, 8000);
  }
});

// Lock UI when not authed
function setAppLocked(locked) {
  const disableIds = [
    "btnExport","btnDebug","btnClearAll",
    "btnPrintMedicine","btnSaveMedicine","btnNewMedicine","btnSearchMedicine",
    "btnSaveCustomer","btnResetCustomer",
    "btnAddSaleItem","btnFinalizeSale","btnResetSale","btnPrintSales"
  ];

  disableIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });

  const inputs = document.querySelectorAll("input, textarea, select");
  inputs.forEach(el => {
    if (["authEmail","authPass"].includes(el.id)) return;
    el.disabled = locked;
  });
}

// Auth watcher
onAuthStateChanged(auth, (user) => {
  currentUser = user || null;

  if (!user) {
    setAuthBadge("Auth: Locked 🔒", false);
    document.getElementById("btnLogout").style.display = "none";
    document.getElementById("btnLoginOpen").style.display = "";
    setAppLocked(true);
    stopRealtime();
    setConn("Disconnected ❌", false);
    wowToast("Login Required", "Only authorized users can access records.", false, 4500);
    return;
  }

  setAuthBadge("Auth: " + (user.email || "User") + " ✅", true);
  document.getElementById("btnLogout").style.display = "";
  document.getElementById("btnLoginOpen").style.display = "none";
  setAppLocked(false);

  startRealtime();
});

// =========================
// Realtime listeners
// =========================
function stopRealtime() {
  realtimeUnsubs.forEach(fn => { try{ fn(); }catch(_){} });
  realtimeUnsubs = [];
  connectedOnce = false;
  medicinesLoadedOnce = false;
}

function startRealtime() {
  stopRealtime();
  setConn("Connecting…", true);

  realtimeUnsubs.push(onSnapshot(
    query(collection(db, "medicines"), orderBy("id", "asc")),
    (snap) => {
      state.medicines = snap.docs.map(d => {
        const data = d.data();
        return { ...data, id: data.id || d.id, docId: d.id };
      });

      renderMedicines();
      renderSalesMedicineDropdown();

      if (!medicinesLoadedOnce) {
        medicinesLoadedOnce = true;
        setMedicineFormToNextFromFirebase();
      } else {
        const loaded = findMedicineById(el_mId.value);
        if (!loaded) $("nextIdPill").textContent = "Next ID: " + computeNextMedicineIdFromState();
      }

      if (!connectedOnce) finishConnected("medicines");
    },
    (err) => realtimeFail("medicines", err)
  ));

  realtimeUnsubs.push(onSnapshot(
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
  ));

  trySalesListenerPrimary();
}

function trySalesListenerPrimary() {
  realtimeUnsubs.push(onSnapshot(
    query(collection(db, "sales"), orderBy("createdAt", "desc")),
    (snap) => {
      state.sales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSalesHistory();
      renderRevenueKpis();
      if (!connectedOnce) finishConnected("sales");
    },
    (err) => {
      console.warn("Sales primary listener failed, fallback:", err);
      wowToast("Sales Listener", "Fallback enabled.\n" + explainFirestoreError(err), false, 2500);
      trySalesListenerFallback();
    }
  ));
}
function trySalesListenerFallback() {
  realtimeUnsubs.push(onSnapshot(
    query(collection(db, "sales"), orderBy("date", "desc")),
    (snap) => {
      state.sales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSalesHistory();
      renderRevenueKpis();
      if (!connectedOnce) finishConnected("sales");
      wowToast("Sales Fallback", "Using date order. CreatedAt index optional.", true, 3000);
    },
    (err) => realtimeFail("sales(fallback)", err)
  ));
}

function realtimeFail(name, err) {
  console.error(`Realtime error [${name}]`, err);
  setConn("Disconnected ❌", false);
  wowToast("Realtime Failed", `${name}\n\n${explainFirestoreError(err)}`, false, 12000);
}

function finishConnected(sourceName) {
  connectedOnce = true;
  setConn("Connected ✅", true);
  wowToast("Connected ✅", `Listener: ${sourceName}`, true, 2200);
  renderAll();
}

// =========================
// Medicine Buttons
// =========================
$("btnNewMedicine").addEventListener("click", () => {
  try {
    setMedicineFormToNextFromFirebase();
    el_mName.focus();
  } catch (e) {
    wowToast("New Medicine Error", e.message, false, 9000);
  }
});

$("btnSearchMedicine").addEventListener("click", () => {
  try {
    const id = pad3((el_mSearchId.value || "").trim());
    if (!id) throw new Error("Enter Record ID (e.g. 001).");
    const m = findMedicineById(id);
    if (!m) throw new Error("No medicine found for ID " + id);
    fillMedicineForm(m);
  } catch (e) {
    wowToast("Search Failed", e.message, false, 8000);
  }
});

$("btnSaveMedicine").addEventListener("click", async () => {
  try {
    const id = pad3((el_mId.value || "").trim());
    const name = (el_mName.value || "").trim();
    const addQty = parseInt(el_mAddQty.value, 10) || 0;
    const note = (el_mNote.value || "").trim();

    if (!id) throw new Error("Record ID missing.");
    if (!name) throw new Error("Medicine name is required.");
    if (addQty < 0) throw new Error("Quantity cannot be negative.");

    const ref = doc(db, "medicines", id);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);

      if (!snap.exists()) {
        if (addQty <= 0) throw new Error("For new medicine, add some qty (>0).");
        tx.set(ref, {
          id, name, note,
          totalQty: addQty,
          availableQty: addQty,
          updatedAt: serverTimestamp(),
        });
      } else {
        const updates = { id, name, note, updatedAt: serverTimestamp() };
        if (addQty > 0) {
          updates.totalQty = increment(addQty);
          updates.availableQty = increment(addQty);
        }
        tx.update(ref, updates);
      }
    });

    wowToast("Saved ✅", `Medicine "${name}" saved.\nNext ID ready.`, true, 2600);

    const nextNum = (parseInt(id, 10) || 0) + 1;
    el_mId.value = pad3(nextNum);
    el_mName.value = "";
    el_mAddQty.value = "";
    el_mNote.value = "";
    el_mSearchId.value = "";
    $("nextIdPill").textContent = "Next ID: " + el_mId.value;
    el_mName.focus();

  } catch (err) {
    console.error(err);
    wowToast("Save Failed", explainFirestoreError(err), false, 12000);
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

    await setDoc(doc(db, "customers", mobile), {
      name, mobile, address,
      updatedAt: serverTimestamp()
    }, { merge: true });

    el_cName.value = ""; el_cMobile.value = ""; el_cAddress.value = "";
    wowToast("Saved ✅", "Customer saved successfully.", true, 2200);

  } catch (err) {
    console.error(err);
    wowToast("Customer Save Failed", explainFirestoreError(err), false, 12000);
  }
});

$("btnResetCustomer").addEventListener("click", () => {
  el_cName.value = ""; el_cMobile.value = ""; el_cAddress.value = "";
  wowToast("Cleared", "Customer form cleared.", true, 1600);
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
    wowToast("Customer Sync Error", e.message, false, 8000);
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
    wowToast("Added ✅", `${m.name} × ${qty}`, true, 1700);

  } catch (e) {
    wowToast("Add Item Failed", e.message, false, 9000);
  }
});

$("btnResetSale").addEventListener("click", () => {
  clearSaleForm(false);
  wowToast("Cleared", "Sale form cleared.", true, 1600);
});

$("btnFinalizeSale").addEventListener("click", async () => {
  try {
    const customer = el_sCustomer.value.trim();
    const mobile = el_sMobile.value.trim();
    const address = el_sAddress.value.trim();
    const note = el_sNote.value.trim();
    const payNote = el_sPayNote.value.trim();

    const charged = Number(el_sCharged.value || 0);
    if (!Number.isFinite(charged) || charged < 0) throw new Error("Charged Amount (PKR) must be 0 or more.");

    if (!customer) throw new Error("Customer name required.");
    if (!mobile) throw new Error("Mobile required.");
    if (currentSaleItems.length === 0) throw new Error("Add at least one item.");

    const salePayload = {
      date: nowStr(),
      customer,
      mobile,
      address,
      note,
      payNote,
      chargedPKR: charged,
      currency: "PKR",
      items: currentSaleItems.map(i => ({ medId: pad3(i.medId), medName: i.medName, qty: i.qty }))
    };

    await runTransaction(db, async (tx) => {
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

      for (const it of salePayload.items) {
        const mref = doc(db, "medicines", pad3(it.medId));
        tx.update(mref, { availableQty: increment(-Number(it.qty || 0)), updatedAt: serverTimestamp() });
      }

      const cref = doc(db, "customers", mobile);
      tx.set(cref, { name: customer, mobile, address, updatedAt: serverTimestamp() }, { merge: true });

      const sref = doc(collection(db, "sales"));
      tx.set(sref, { ...salePayload, createdAt: serverTimestamp() });
    });

    clearSaleForm(true);
    wowToast("Sale Saved ✅", `Stock updated.\nRevenue: ${pk(charged)}`, true, 2600);

  } catch (err) {
    console.error(err);
    wowToast("Sale Failed", explainFirestoreError(err), false, 12000);
  }
});

// Filter changes
el_salesFilter.addEventListener("change", () => {
  renderSalesHistory();
  renderRevenueKpis();
});

// =========================
// Revenue KPIs
// =========================
function computeRevenue() {
  const now = new Date();
  let todaySum = 0, todayCount = 0;
  let monthSum = 0, monthCount = 0;
  let allSum = 0;

  for (const s of state.sales) {
    const charged = Number(s.chargedPKR || 0);
    if (Number.isFinite(charged)) allSum += charged;

    const d = parseLocalDateFromSaleStr(s.date);
    if (!d) continue;

    if (isSameDay(d, now)) { todaySum += charged; todayCount++; }
    if (isSameMonth(d, now)) { monthSum += charged; monthCount++; }
  }

  return { todaySum, todayCount, monthSum, monthCount, allSum };
}

function computeFilteredSalesAndRevenue() {
  const mode = el_salesFilter.value || "all";
  const now = new Date();

  const filtered = [];
  let sum = 0;

  for (const s of state.sales) {
    const d = parseLocalDateFromSaleStr(s.date);
    const charged = Number(s.chargedPKR || 0);

    let ok = true;
    if (mode === "today") ok = d ? isSameDay(d, now) : false;
    else if (mode === "month") ok = d ? isSameMonth(d, now) : false;

    if (ok) {
      filtered.push(s);
      if (Number.isFinite(charged)) sum += charged;
    }
  }

  return { filtered, sum, mode };
}

function renderRevenueKpis() {
  const r = computeRevenue();
  el_kpiToday.textContent = pk(r.todaySum);
  el_kpiMonth.textContent = pk(r.monthSum);
  el_kpiAll.textContent = pk(r.allSum);

  el_kpiTodayMeta.textContent = `${r.todayCount} sales today`;
  el_kpiMonthMeta.textContent = `${r.monthCount} sales this month`;
  el_kpiAllMeta.textContent = `All-time: ${state.sales.length} sales`;

  const fr = computeFilteredSalesAndRevenue();
  const tag = fr.mode === "today" ? "Today"
           : fr.mode === "month" ? "This Month"
           : "All";
  el_filterRevenuePill.textContent = `Filter Revenue (${tag}): ${pk(fr.sum)}`;
}

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

  const loaded = findMedicineById(el_mId.value);
  if (loaded) {
    $("nextIdPill").textContent = "Loaded ID: " + loaded.id;
    el_mAvail.value = String(Number(loaded.availableQty || 0));
    el_mTotal.value = String(Number(loaded.totalQty || 0));
  } else {
    $("nextIdPill").textContent = "Next ID: " + computeNextMedicineIdFromState();
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
      wowToast("Removed", "Item removed from sale.", true, 1500);
    });
  });
}

function renderSalesHistory() {
  const tbody = document.querySelector("#salesTable tbody");
  tbody.innerHTML = "";

  const { filtered } = computeFilteredSalesAndRevenue();

  for (const s of filtered) {
    const itemsText = (s.items || []).map(i => `${i.medName} × ${i.qty}`).join(", ");
    const charged = Number(s.chargedPKR || 0);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.date || "")}</td>
      <td>${escapeHtml(s.customer || "")}</td>
      <td>${escapeHtml(s.mobile || "")}</td>
      <td><b>${escapeHtml(String(charged))}</b></td>
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
  const r = computeRevenue();
  const printedAt = new Date().toLocaleString();

  const w = window.open("", "_blank", "width=1040,height=760");
  w.document.open();
  w.document.write(`
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  *{ box-sizing:border-box; }
  body{ font-family: "Calibri", Arial, sans-serif; padding: 22px; color:#0b0b0b; }
  .sheet{
    border: 4px solid #2f7a60;
    border-radius: 12px;
    padding: 18px;
  }
  .header{
    display:flex; gap:14px; align-items:center;
    border-bottom:2px solid #d7d7d7;
    padding-bottom:12px;
    margin-bottom:14px;
  }
  .header img{ height:70px; width:auto; object-fit:contain; }
  .header h1{ margin:0; font-size:18px; letter-spacing:.2px; }
  .header small{ display:block; margin-top:5px; color:#444; font-weight:600; }
  .meta{
    display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;
    margin: 10px 0 14px 0;
    font-size:12px; color:#333;
  }
  .metaBox{
    border:1px solid #e2e2e2;
    border-left:5px solid #f2c15b;
    padding:10px 12px;
    border-radius:10px;
    min-width: 260px;
    background:#fafafa;
  }
  .metaBox b{display:block; font-size:12px; color:#222; margin-bottom:6px}
  .metaBox span{font-weight:700}
  table{ width:100%; border-collapse:collapse; font-size:12.5px; }
  th, td{ padding:10px; border:1px solid #dcdcdc; text-align:left; vertical-align:top; }
  th{ background:#f2f7f4; font-weight:800; text-transform:uppercase; font-size:11.5px; letter-spacing:.25px; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <img src="${LOGO_URL}" alt="Logo" onerror="this.style.display='none'"/>
      <div>
        <h1>${escapeHtml(headerTitle)}</h1>
        <small>${escapeHtml(headerSubtitle)}</small>
      </div>
    </div>

    <div class="meta">
      <div class="metaBox">
        <b>Printed On</b>
        <span>${escapeHtml(printedAt)}</span>
      </div>
      <div class="metaBox">
        <b>Revenue Summary (PKR)</b>
        <span>Today: ${escapeHtml(String(r.todaySum))}</span><br/>
        <span>Month: ${escapeHtml(String(r.monthSum))}</span><br/>
        <span>Overall: ${escapeHtml(String(r.allSum))}</span>
      </div>
      ${extraMetaHtml ? `<div class="metaBox"><b>Notes</b><span>${extraMetaHtml}</span></div>` : ""}
    </div>

    ${bodyHtml}
  </div>
  <script>window.onload = function(){ window.print(); };</script>
</body>
</html>
  `);
  w.document.close();
}

$("btnPrintMedicine").addEventListener("click", () => {
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

$("btnPrintSales").addEventListener("click", () => {
  const printArea = document.getElementById("salesPrintArea");
  const html = printArea ? printArea.innerHTML : "<p>No sales to print</p>";

  const filter = el_salesFilter.value || "all";
  const tag = filter === "today" ? "Today"
           : filter === "month" ? "This Month"
           : "All";
  openPrintWindow({
    title: "Sales Sheet",
    headerTitle: "SHIFA-UL-DAHAR — Sales Sheet",
    headerSubtitle: "Rohani u Jasmani Ilaj Gah",
    extraMetaHtml: `Filter: ${escapeHtml(tag)} • Includes Charged PKR + Notes`,
    bodyHtml: html
  });
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
          ChargedPKR: Number(s.chargedPKR || 0),
          PayNote: s.payNote || "",
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

    wowToast("Exported ✅", "Excel file downloaded.", true, 2300);
  } catch (e) {
    wowToast("Export Failed", e.message, false, 10000);
  }
});

// =========================
// Clear All
// =========================
$("btnClearAll").addEventListener("click", async () => {
  if (!confirm("This will delete ALL medicines, customers and sales. Continue?")) return;
  try {
    await deleteCollectionAll("sales");
    await deleteCollectionAll("customers");
    await deleteCollectionAll("medicines");
    clearSaleForm(false);
    setMedicineFormToNextFromFirebase();
    renderAll();
    renderRevenueKpis();
    wowToast("Cleared ✅", "All data deleted.", true, 2600);
  } catch (err) {
    console.error(err);
    wowToast("Clear Failed", explainFirestoreError(err), false, 12000);
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
// Debug
// =========================
$("btnDebug").addEventListener("click", () => {
  const lines = [];
  lines.push("DEBUG INFO");
  lines.push("Project: " + firebaseConfig.projectId);
  lines.push("User: " + (currentUser?.email || "none"));
  lines.push("Medicines loaded: " + state.medicines.length);
  lines.push("Next ID: " + computeNextMedicineIdFromState());
  lines.push("Customers loaded: " + state.customers.length);
  lines.push("Sales loaded: " + state.sales.length);
  lines.push("URL: " + location.href);
  wowToast("Debug", lines.join("\n"), true, 6500);
});

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
  renderRevenueKpis();
}

// =========================
// INIT
// =========================
setMedicineFormToNextFromFirebase(); // temporary until firebase loads
renderAll();
startLiveClock();
// realtime starts after successful login (onAuthStateChanged)
