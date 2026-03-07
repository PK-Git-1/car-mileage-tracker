'use strict';

/* ===================== STORAGE & API ===================== */
const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/PK-Git-1/punchu/main/fuel-log.json';
const API_BASE = 'http://localhost:3000/api';
let currentUsername = ''; // Session-only (not persisted)

function getUsername() { return currentUsername; }
function uid()       { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

// Load data from GitHub
async function loadDataFromAPI() {
  try {
    console.log('📡 Fetching data from GitHub:', GITHUB_RAW_URL);
    const response = await fetch(GITHUB_RAW_URL);
    console.log('Response status:', response.status);
    if (!response.ok) {
      throw new Error(`GitHub Error: ${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    console.log('✓ Data loaded from GitHub:', json?.length || 0, 'entries');
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.error('❌ Error loading data from GitHub:', err.message);
    showToast('⚠️ Failed to load data from GitHub. Check your internet connection.', 'error');
    return [];
  }
}

// Save data to API with git commit
async function persistData(d, message = 'Update fuel log') {
  try {
    console.log('💾 Saving', d.length, 'entries to API...');
    const response = await fetch(`${API_BASE}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: d, message })
    });
    console.log('Response status:', response.status);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API Error: ${response.status} ${errText}`);
    }
    const result = await response.json();
    console.log('✓ Data saved and committed to Git');
    showToast('✓ Data saved to Git', 'success');
    return true;
  } catch (err) {
    console.error('❌ Error saving data:', err.message);
    showToast('❌ Failed to save data. Server error: ' + err.message, 'error');
    return false;
  }
}

let siTimer;
function setSaveIndicator(state) {
  const el = document.getElementById('saveIndicator');
  clearTimeout(siTimer);
  if (state === 'saving') { el.className = 'save-indicator saving'; el.textContent = '● saving…'; }
  else if (state === 'saved') { el.className = 'save-indicator saved'; el.textContent = '✔ saved'; siTimer = setTimeout(() => { el.textContent = ''; el.className = 'save-indicator'; }, 2500); }
  else { el.className = 'save-indicator'; el.textContent = ''; }
}

/* ===================== DATA LOADING ===================== */
let data = [];

async function initializeData() {
  // Load from API/Git
  data = await loadDataFromAPI();
  console.log(`Loaded ${data.length} entries from Git`);
  render();
}

/* ===================== SORT ===================== */
let sortKey = 'date', sortAsc = false;
function sortBy(key) { if (sortKey === key) sortAsc = !sortAsc; else { sortKey = key; sortAsc = false; } render(); }

/* ===================== COMPUTED FIELDS ===================== */
function totalKM(r)     { return (r.endKM != null && r.endKM !== '') ? r.endKM - r.startKM : null; }
function remainKM(r)    { return (r.remainingKM != null && r.remainingKM !== '') ? +r.remainingKM : 0; }
function inKM(r)        { return (r.incomingKM  != null && r.incomingKM  !== '') ? +r.incomingKM  : 0; }
// effectiveKM = km driven + outgoing range (at next pump) − incoming range (before THIS fill)
function effectiveKM(r) { const k = totalKM(r); return k != null ? k + remainKM(r) - inKM(r) : null; }
function mileage(r)     { const e = effectiveKM(r); return (e != null && r.fuelQty) ? e / r.fuelQty : null; }
function overallAvgMileage() {
  const valid = data.filter(r => mileage(r) != null);
  if (!valid.length) return null;
  const te = valid.reduce((s, r) => s + effectiveKM(r), 0);
  const tq = valid.reduce((s, r) => s + r.fuelQty, 0);
  return tq > 0 ? te / tq : null;
}

/* ===================== FORMATTERS ===================== */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOWS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function fmtN(n, d=2) { return n == null ? '\u2014' : (+n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtI(n)      { return n == null ? '\u2014' : Math.round(n).toLocaleString('en-IN'); }
function fmtMon(n)    { return n == null ? '\u2014' : '\u20B9' + fmtN(n, 0); }
function fmtDate(d) {
  if (!d) return '\u2014';
  const p = d.split('-');
  const dt = new Date(d + 'T00:00:00');
  return '<div class="date-str">' + p[2] + '-' + MONTHS[+p[1]-1] + '-' + p[0].slice(2) + '</div>'
       + '<div class="dow">' + DOWS[dt.getDay()] + '</div>';
}

/* ===================== RENDER ===================== */
function render() {
  const sorted = [...data].sort((a, b) => {
    let va, vb;
    if (sortKey === 'totalKM')  { va = totalKM(a);  vb = totalKM(b); }
    else if (sortKey === 'mileage') { va = mileage(a); vb = mileage(b); }
    else { va = a[sortKey]; vb = b[sortKey]; }
    const nv = sortAsc ? Infinity : -Infinity;
    va = va ?? nv; vb = vb ?? nv;
    return va < vb ? (sortAsc ? -1 : 1) : va > vb ? (sortAsc ? 1 : -1) : 0;
  });

  document.querySelectorAll('thead th').forEach(th => {
    th.classList.remove('sorted');
    const ic = th.querySelector('.sort-icon');
    if (ic) ic.innerHTML = '&#8645;';
  });
  const ath = document.getElementById('th-' + sortKey);
  if (ath) { ath.classList.add('sorted'); ath.querySelector('.sort-icon').innerHTML = sortAsc ? '&#9650;' : '&#9660;'; }

  const tbody = document.getElementById('tableBody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="13"><div class="empty-state"><p>No entries yet.</p><button class="btn btn-primary" onclick="openAdd()">Add First Entry</button></div></td></tr>';
    updateSummary();
    return;
  }

  tbody.innerHTML = sorted.map(r => {
    const km  = totalKM(r);
    const mil = mileage(r);
    const milCell = mil == null ? '<span style="color:var(--text-light)">\u2014</span>'
      : mil >= 15   ? '<span class="badge badge-green"><b>'  + fmtN(mil, 2) + '</b></span>'
      : mil >= 12.5 ? '<span class="badge badge-blue"><b>'   + fmtN(mil, 2) + '</b></span>'
      : mil >= 10   ? '<span class="badge badge-amber"><b>'  + fmtN(mil, 2) + '</b></span>'
      :               '<span class="badge badge-red"><b>'    + fmtN(mil, 2) + '</b></span>';
    const projCell = r.projected != null
      ? '<span class="badge badge-blue">' + fmtI(r.projected) + ' km</span>'
      : '<span style="color:var(--text-light)">\u2014</span>';
    return '<tr>'
      + '<td><div class="bunk-cell" title="' + r.bunk + '">' + r.bunk + '</div></td>'
      + '<td>' + fmtDate(r.date) + '</td>'
      + '<td class="num">' + fmtI(r.startKM) + '</td>'
      + '<td class="num">' + (r.endKM != null ? fmtI(r.endKM) : '<span style="color:var(--text-light)">\u2014</span>') + '</td>'
      + '<td class="num">' + (km != null ? fmtI(km) + ' km' : '<span style="color:var(--text-light)">\u2014</span>') + '</td>'
      + '<td>' + projCell + '</td>'
      + '<td class="num">' + (r.incomingKM != null && r.incomingKM !== ''
          ? '<span class="badge badge-blue" title="Range before filling here">&#8595; ' + fmtI(r.incomingKM) + ' km</span>'
          : '<span style="color:var(--text-light)">\u2014</span>') + '</td>'
      + '<td class="num">' + (r.remainingKM != null && r.remainingKM !== ''
          ? '<span class="badge badge-amber" title="Range arriving at next pump">&#8593; ' + fmtI(r.remainingKM) + ' km</span>'
          : '<span style="color:var(--text-light)">\u2014</span>') + '</td>'
      + '<td class="num">' + fmtMon(r.fuelAmount) + '</td>'
      + '<td class="num">' + fmtN(r.fuelRate, 2) + '</td>'
      + '<td class="num">' + (r.fuelQty != null ? fmtN(r.fuelQty, 2) + ' L' : '\u2014') + '</td>'
      + '<td>' + milCell + '</td>'
      + '<td><div class="actions">'      + '<button class="btn btn-icon-edit btn-sm" onclick="openEdit(\'' + r.id + '\')">'
      + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit</button>'
      + '<button class="btn btn-icon-del btn-sm" onclick="openDelete(\'' + r.id + '\')">'
      + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg> Del</button>'
      + '</div></td></tr>';
  }).join('');

  document.getElementById('countLabel').textContent = data.length + ' record' + (data.length !== 1 ? 's' : '');
  updateSummary();
  rebuildBunkList();
}

function updateSummary() {
  const ta = data.reduce((s, r) => s + (r.fuelAmount || 0), 0);
  const tl = data.reduce((s, r) => s + (r.fuelQty    || 0), 0);
  const tk = data.reduce((s, r) => s + (totalKM(r)   || 0), 0);
  const am = overallAvgMileage();
  const ar = tl > 0 ? ta / tl : null;
  document.getElementById('sumEntries').textContent = data.length;
  document.getElementById('sumAmount').textContent  = fmtMon(ta);
  document.getElementById('sumLitres').textContent  = fmtN(tl, 1) + ' L';
  document.getElementById('sumKM').textContent      = fmtI(tk) + ' km';
  document.getElementById('sumMileage').textContent = am ? fmtN(am, 2) + ' km/L' : '\u2014';
  document.getElementById('sumRate').textContent    = ar ? '\u20B9' + fmtN(ar, 2) : '\u2014';
}

function rebuildBunkList() {
  const names = [...new Set(data.map(r => r.bunk).filter(Boolean))].sort();
  document.getElementById('bunkList').innerHTML = names.map(n => '<option value="' + n + '">').join('');
}

/* ===================== FORM CALCULATIONS ===================== */
function calcAll() {
  const amount = parseFloat(document.getElementById('f_amount').value);
  const rate   = parseFloat(document.getElementById('f_rate').value);
  const qEl    = document.getElementById('qtyDisplay');
  const qHid   = document.getElementById('f_qty');

  let qty = null;
  if (amount > 0 && rate > 0) {
    qty = amount / rate;
    qEl.textContent = fmtN(qty, 2) + ' L';
    qHid.value = qty.toFixed(4);
  } else {
    qEl.textContent = 'Enter amount and rate';
    qHid.value = '';
  }

  // Auto-populate To KM when Adding (not editing) and user hasn't typed it manually
  const endKMEl = document.getElementById('f_endKM');
  const sk = parseFloat(document.getElementById('f_startKM').value);
  if (!editId && !endKMEl._userEdited && qty != null && !isNaN(sk)) {
    const avg = overallAvgMileage();
    if (avg) endKMEl.value = Math.round(sk + avg * qty);
  }

  const ek  = parseFloat(endKMEl.value);
  const rmv = parseFloat(document.getElementById('f_remainKM').value);
  const imv = parseFloat(document.getElementById('f_incomingKM').value);
  const tEl = document.getElementById('totalKMDisplay');
  const eEl = document.getElementById('effectiveKMDisplay');

  if (!isNaN(sk) && !isNaN(ek) && ek >= sk) {
    const tkm = ek - sk;
    tEl.textContent = fmtI(tkm) + ' km';
    const out = isNaN(rmv) ? 0 : rmv;
    const inc = isNaN(imv) ? 0 : imv;
    const eff = tkm + out - inc;
    if (out > 0 || inc > 0) {
      let expr = fmtI(tkm);
      if (out > 0) expr += ' + ' + fmtI(out);
      if (inc > 0) expr += ' \u2212 ' + fmtI(inc);
      eEl.textContent = expr + ' = ' + fmtI(eff) + ' km';
    } else {
      eEl.textContent = fmtI(eff) + ' km (enter in/out range for accurate calc)';
    }
  } else {
    tEl.textContent = 'Enter From and To KM';
    eEl.textContent = 'Enter KM values above';
  }

  const pf = document.getElementById('f_projected');
  if (!pf._userEdited) {
    const avg = overallAvgMileage();
    if (qty && avg) { pf.placeholder = Math.round(qty * avg) + ' (suggested)'; }
    else { pf.placeholder = 'Auto-suggested from avg mileage'; }
  }
}

/* ===================== MODAL: ADD / EDIT ===================== */
let editId = null;

function openAdd() {
  editId = null;
  document.getElementById('modalTitle').textContent = 'Add Fuel Entry';
  document.getElementById('saveBtn').innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> Add Entry';
  resetForm();
  document.getElementById('f_date').value = new Date().toISOString().slice(0, 10);
  // Auto-fill From KM from the latest endKM in data
  const latest = data.slice().sort((a, b) => (b.endKM ?? 0) - (a.endKM ?? 0)).find(r => r.endKM != null);
  if (latest) {
    document.getElementById('f_startKM').value = latest.endKM;
    calcAll(); // trigger To KM suggestion right away
  }
  document.getElementById('formOverlay').classList.add('open');
  rebuildBunkList();
}

function openEdit(id) {
  const r = data.find(x => x.id === id);
  if (!r) return;
  editId = id;
  document.getElementById('modalTitle').textContent = 'Edit Fuel Entry';
  document.getElementById('saveBtn').innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Update Entry';
  document.getElementById('f_bunk').value       = r.bunk        || '';
  document.getElementById('f_date').value       = r.date        || '';
  document.getElementById('f_amount').value     = r.fuelAmount  ?? '';
  document.getElementById('f_rate').value       = r.fuelRate    ?? '';
  document.getElementById('f_startKM').value    = r.startKM     ?? '';
  const endKMEl = document.getElementById('f_endKM');
  endKMEl.value = r.endKM ?? '';
  endKMEl._userEdited = true; // editing: never auto-overwrite existing To KM
  document.getElementById('f_incomingKM').value = r.incomingKM  ?? '';
  document.getElementById('f_remainKM').value   = r.remainingKM ?? '';
  const pf = document.getElementById('f_projected');
  pf.value = r.projected ?? '';
  pf._userEdited = r.projected != null;
  calcAll();
  document.getElementById('formOverlay').classList.add('open');
  rebuildBunkList();
}

function closeModal() {
  document.getElementById('formOverlay').classList.remove('open');
  resetForm();
  editId = null;
}

function resetForm() {
  document.getElementById('entryForm').reset();
  document.getElementById('qtyDisplay').textContent         = 'Enter amount and rate';
  document.getElementById('totalKMDisplay').textContent     = 'Enter From and To KM';
  document.getElementById('effectiveKMDisplay').textContent = 'Enter KM values above';
  document.getElementById('f_qty').value = '';
  const endKMEl = document.getElementById('f_endKM');
  endKMEl.value = '';
  endKMEl._userEdited = false; // allow auto-populate in Add mode
  document.getElementById('f_incomingKM').value = '';
  const pf = document.getElementById('f_projected');
  pf._userEdited = false;
  pf.placeholder = 'Auto-suggested from avg mileage';
}

// Lock To KM from auto-populate once user manually types it
document.getElementById('f_endKM').addEventListener('input', function() {
  this._userEdited = this.value !== '';
});

document.getElementById('f_projected').addEventListener('input', function() {
  this._userEdited = this.value !== '';
});

/* ===================== SAVE ENTRY ===================== */
function saveEntry(e) {
  if (e) e.preventDefault();
  const bunk    = document.getElementById('f_bunk').value.trim();
  const date    = document.getElementById('f_date').value;
  const amount  = parseFloat(document.getElementById('f_amount').value);
  const rate    = parseFloat(document.getElementById('f_rate').value);
  const startKM = parseFloat(document.getElementById('f_startKM').value);
  const endKMv  = document.getElementById('f_endKM').value;
  const endKM   = endKMv !== '' ? parseFloat(endKMv) : null;
  const incomingKMv = document.getElementById('f_incomingKM').value;
  const incomingKM  = incomingKMv !== '' ? parseFloat(incomingKMv) : null;
  const remainKMv   = document.getElementById('f_remainKM').value;
  const remainingKM = remainKMv  !== '' ? parseFloat(remainKMv)  : null;
  const projv  = document.getElementById('f_projected').value;
  const qty    = parseFloat(document.getElementById('f_qty').value);

  if (!bunk || !date || isNaN(amount) || isNaN(rate) || isNaN(startKM)) {
    showToast('Fill all required fields.', 'error'); return;
  }
  if (endKM !== null && endKM < startKM) {
    showToast('To KM cannot be less than From KM.', 'error'); return;
  }

  const finalQty = isNaN(qty) ? +(amount / rate).toFixed(4) : +qty.toFixed(4);
  let projected = projv !== '' ? parseFloat(projv) : null;
  if (projected == null) { const avg = overallAvgMileage(); if (avg) projected = Math.round(finalQty * avg); }

  const entry = { bunk, date, startKM, endKM, incomingKM, remainingKM, fuelAmount: amount, fuelRate: rate, fuelQty: finalQty, projected };
  if (editId) {
    const idx = data.findIndex(r => r.id === editId);
    if (idx > -1) data[idx] = { ...data[idx], ...entry };
    showToast('Entry updated!', 'success');
  } else {
    data.push({ id: uid(), ...entry });
    showToast('Entry added!', 'success');
  }
  persistData(data);
  closeModal();
  render();
}

/* ===================== DELETE ===================== */
let deleteId = null;
function openDelete(id)  { deleteId = id; document.getElementById('delOverlay').classList.add('open'); }
function closeDelete()   { deleteId = null; document.getElementById('delOverlay').classList.remove('open'); }
function confirmDelete() {
  if (!deleteId) return;
  data = data.filter(r => r.id !== deleteId);
  persistData(data);
  closeDelete();
  render();
  showToast('Entry deleted.', 'success');
}

function overlayClick(e, id) {
  if (e.target.id === id) { id === 'formOverlay' ? closeModal() : closeDelete(); }
}

/* ===================== TOAST ===================== */
let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.className = 'toast ' + type;
  const ic = type === 'success'
    ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  t.innerHTML = ic + msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDelete(); } });

// Initialize on DOM ready
function checkLoginScreen() {
  const username = getUsername();
  
  // Always show login screen if not logged in
  if (!username) {
    showLoginScreen();
  } else {
    hideLoginScreen();
    showMainContent();
    initializeData();
  }
}

function showLoginScreen() {
  const loginScreen = document.getElementById('loginScreen');
  const mainContent = document.getElementById('mainContent');
  if (loginScreen) {
    loginScreen.classList.remove('hidden');
  }
  if (mainContent) {
    mainContent.style.display = 'none';
  }
}

function hideLoginScreen() {
  const loginScreen = document.getElementById('loginScreen');
  if (loginScreen) {
    loginScreen.classList.add('hidden');
  }
}

function showMainContent() {
  const mainContent = document.getElementById('mainContent');
  if (mainContent) {
    mainContent.style.display = 'block';
  }
}

function logout() {
  if (confirm('Are you sure you want to logout?')) {
    currentUsername = ''; // Clear session
    showToast('Logged out successfully', 'success');
    setTimeout(() => {
      location.reload();
    }, 1000);
  }
}

function submitLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  
  if (!username) {
    showToast('Please enter a username', 'error');
    return;
  }
  
  if (!password) {
    showToast('Please enter a password', 'error');
    return;
  }
  
  if (username.length < 3) {
    showToast('Username must be at least 3 characters', 'error');
    return;
  }
  
  if (password.length < 4) {
    showToast('Password must be at least 4 characters', 'error');
    return;
  }
  
  // Store username in session (not persisted)
  currentUsername = username;
  hideLoginScreen();
  showMainContent();
  showToast('Welcome ' + username + '!', 'success');
  initializeData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkLoginScreen);
} else {
  checkLoginScreen();
}
