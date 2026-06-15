'use strict';

/* ===================== STORAGE & API ===================== */
// IMPORTANT: Update this URL after deploying Google Apps Script
// Deploy script from AppsScript.js at: https://script.google.com
// Then paste the deployment URL here
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxGb6gz0affXpTGJ1x8x0xnrExJHjl7Y7xwlIVWDgnxZ-9cMlKR0v1jXAcmAz3IYPDQtg/exec';

let currentUsername = '';
let deleteId = null;
function getUsername() { return currentUsername; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ============ API CALLS TO GOOGLE APPS SCRIPT ============

async function callAppsScript(action, payload = {}) {
  try {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.append('action', action);
    
    let options;
    
    if (action.startsWith('get')) {
      // GET request - no body, no custom headers to avoid CORS preflight
      options = { method: 'GET' };
      if (payload.id) url.searchParams.append('id', payload.id);
    } else {
      // POST request - use text/plain to avoid CORS preflight
      // (application/json triggers preflight which Apps Script can't handle)
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      };
    }
    
    const response = await fetch(url.toString(), options);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    console.error(`❌ API Error (${action}):`, err.message);
    showToast(`❌ Connection error: ${err.message}`, 'error');
    throw err;
  }
}

// Load all data from Google Sheets
async function loadDataFromAPI() {
  try {
    console.log('📡 Fetching data from Google Sheets...');
    const result = await callAppsScript('get');
    if (result.success) {
      let json = result.data || [];
      console.log('✓ Data loaded:', json.length, 'entries');
      
      // Normalize date format for all entries and fix timezone issues
      if (Array.isArray(json)) {
        json = json.map(entry => {
          if (entry.date) {
            const original = entry.date;
            entry.date = normalizeDateString(entry.date);
            console.log(`📅 Date normalized: "${original}" → "${entry.date}"`);
          }
          return entry;
        });
      }
      
      return Array.isArray(json) ? json : [];
    }
    throw new Error(result.error || 'Failed to load data');
  } catch (err) {
    console.error('❌ Error loading data:', err.message);
    showToast('⚠️ Failed to load data. Check connection.', 'error');
    return [];
  }
}

// Save single entry (create)
async function addEntryAPI(entry) {
  try {
    console.log('💾 Saving entry:', entry.id);
    const result = await callAppsScript('add', { entry });
    if (result.success) {
      showToast('✓ Entry saved', 'success');
      return true;
    }
    throw new Error(result.error);
  } catch (err) {
    console.error('❌ Error saving entry:', err.message);
    showToast('❌ Failed to save: ' + err.message, 'error');
    return false;
  }
}

// Update entry
async function updateEntryAPI(id, updates) {
  try {
    const result = await callAppsScript('update', { id, updates });
    if (result.success) {
      showToast('✓ Entry updated', 'success');
      return true;
    }
    throw new Error(result.error);
  } catch (err) {
    console.error('❌ Error updating:', err.message);
    showToast('❌ Failed to update: ' + err.message, 'error');
    return false;
  }
}

// Delete entry
async function deleteEntryAPI(id) {
  try {
    const result = await callAppsScript('delete', { id });
    if (result.success) {
      showToast('✓ Entry deleted', 'success');
      return true;
    }
    throw new Error(result.error);
  } catch (err) {
    console.error('❌ Error deleting:', err.message);
    showToast('❌ Failed to delete: ' + err.message, 'error');
    return false;
  }
}

/* ===================== DATA MANAGEMENT ===================== */
let data = [];

async function initializeData() {
  data = await loadDataFromAPI();
  console.log(`Loaded ${data.length} entries from Google Sheets`);
  render();
}

/* ===================== SORT ===================== */
let sortKey = 'date', sortAsc = false;
function sortBy(key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else { sortKey = key; sortAsc = false; }
  render();
}

/* ===================== COMPUTED FIELDS ===================== */
function totalKM(r) {
  if (r.endKM != null && r.endKM !== '') {
    // Add 41 only for the first item in the data array
    if (data.length && data[0] && r.id === data[0].id) {
      return r.endKM - r.startKM + 41;
    } else {
      return r.endKM - r.startKM;
    }
  }
  return null;
}
function remainKM(r) { return (r.remainingKM != null && r.remainingKM !== '') ? +r.remainingKM : 0; }
function inKM(r) { return (r.incomingKM != null && r.incomingKM !== '') ? +r.incomingKM : 0; }
function effectiveKM(r) { const k = totalKM(r); return k != null ? k + remainKM(r) - inKM(r) : null; }
function mileage(r) { const e = effectiveKM(r); return (e != null && r.fuelQty) ? e / r.fuelQty : null; }
function overallAvgMileage() {
  const valid = data.filter(r => mileage(r) != null);
  if (!valid.length) return null;
  const te = valid.reduce((s, r) => s + effectiveKM(r), 0);
  const tq = valid.reduce((s, r) => s + r.fuelQty, 0);
  return tq > 0 ? te / tq : null;
}

/* ===================== FORMATTERS ===================== */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Normalize date string - extract date and add 1 day to account for timezone shift
function normalizeDateString(dateStr) {
  if (!dateStr) return null;
  
  // Extract just the date part (YYYY-MM-DD) from any format
  const datePart = dateStr.split('T')[0];
  
  // Parse the date and add 1 day
  const date = new Date(datePart + 'T00:00:00');
  date.setDate(date.getDate() + 1);
  
  // Format back to YYYY-MM-DD
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}
function fmtN(n, d = 2) { return n == null ? '—' : (+n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtI(n) { return n == null ? '—' : Math.round(n).toLocaleString('en-IN'); }
function fmtMon(n) { return n == null ? '—' : '₹' + fmtN(n, 0); }
function fmtDate(d) {
  if (!d) return '—';
  
  // Normalize date: handle ISO timestamps or YYYY-MM-DD format
  let dateStr = d;
  if (d.includes('T')) {
    // Extract just the date part from ISO timestamp (e.g., 2025-01-26T18:30:00.000Z -> 2025-01-26)
    dateStr = d.split('T')[0];
  }
  
  const p = dateStr.split('-');
  if (p.length !== 3) return '—';
  
  const dt = new Date(dateStr + 'T00:00:00');
  return `<div class="date-str">${p[2]}-${MONTHS[+p[1] - 1]}-${p[0].slice(2)}</div><div class="dow">${DOWS[dt.getDay()]}</div>`;
}

/* ===================== RENDER TABLE ===================== */
function render() {
  const sorted = [...data].sort((a, b) => {
    let va, vb;
    if (sortKey === 'totalKM') { va = totalKM(a); vb = totalKM(b); }
    else if (sortKey === 'mileage') { va = mileage(a); vb = mileage(b); }
    else { va = a[sortKey]; vb = b[sortKey]; }
    const nv = sortAsc ? Infinity : -Infinity;
    va = va ?? nv;
    vb = vb ?? nv;
    return va < vb ? (sortAsc ? -1 : 1) : va > vb ? (sortAsc ? 1 : -1) : 0;
  });

  document.querySelectorAll('thead th').forEach(th => th.classList.remove('sorted'));
  const ath = document.getElementById('th-' + sortKey);
  if (ath) ath.classList.add('sorted');

  const tbody = document.getElementById('tableBody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="13"><div style="text-align:center;padding:40px 20px;"><p style="color:var(--text-muted);margin-bottom:20px;">No entries yet.</p><button class="btn btn-primary" onclick="openAdd()">➕ Add First Entry</button></div></td></tr>';
    updateSummary();
    return;
  }

  tbody.innerHTML = sorted.map(r => {
    const km = totalKM(r);
    const mil = mileage(r);
    const milCell = mil == null ? '<span style="color:var(--text-light)">—</span>'
      : mil >= 15 ? `<span class="badge badge-green">${fmtN(mil, 2)}</span>`
        : mil >= 12.5 ? `<span class="badge badge-blue">${fmtN(mil, 2)}</span>`
          : mil >= 10 ? `<span class="badge badge-amber">${fmtN(mil, 2)}</span>`
            : `<span class="badge badge-red">${fmtN(mil, 2)}</span>`;

    return `<tr>
      <td><div class="bunk-cell" title="${r.bunk}">${r.bunk}</div></td>
      <td>${fmtDate(r.date)}</td>
      <td class="num">${fmtI(r.startKM)}</td>
      <td class="num">${r.endKM != null ? fmtI(r.endKM) : '<span style="color:var(--text-light)">—</span>'}</td>
      <td class="num">${km != null ? fmtI(km) + ' km' : '<span style="color:var(--text-light)">—</span>'}</td>
      <td><span class="badge badge-blue">${fmtI(r.projected)}</span></td>
      <td class="num">${r.incomingKM != null ? '<span class="badge badge-blue">↓ ' + fmtI(r.incomingKM) + ' km</span>' : '<span style="color:var(--text-light)">—</span>'}</td>
      <td class="num">${r.remainingKM != null ? '<span class="badge badge-amber">↑ ' + fmtI(r.remainingKM) + ' km</span>' : '<span style="color:var(--text-light)">—</span>'}</td>
      <td class="num">${fmtMon(r.fuelAmount)}</td>
      <td class="num">${fmtN(r.fuelRate, 2)}</td>
      <td class="num">${r.fuelQty != null ? fmtN(r.fuelQty, 2) + ' L' : '—'}</td>
      <td>${milCell}</td>
      <td><div class="actions">
        <button class="btn btn-icon-edit btn-sm" onclick="openEdit('${r.id}')">✏️</button>
        <button class="btn btn-icon-del btn-sm" onclick="openDelete('${r.id}')">🗑️</button>
      </div></td>
    </tr>`;
  }).join('');

  document.getElementById('countLabel').textContent = data.length + ' record' + (data.length !== 1 ? 's' : '');
  updateSummary();
  rebuildBunkList();
}

function updateSummary() {
  const ta = data.reduce((s, r) => s + (r.fuelAmount || 0), 0);
  const tl = data.reduce((s, r) => s + (r.fuelQty || 0), 0);
  const tk = data.reduce((s, r) => s + (totalKM(r) || 0), 0);
  const am = overallAvgMileage();
  const ar = tl > 0 ? ta / tl : null;
  
  document.getElementById('sumEntries').textContent = data.length;
  document.getElementById('sumAmount').textContent = fmtMon(ta);
  document.getElementById('sumLitres').textContent = fmtN(tl, 1) + ' L';
  document.getElementById('sumKM').textContent = fmtI(tk) + ' km';
  document.getElementById('sumMileage').textContent = am ? fmtN(am, 2) + ' km/L' : '—';
  document.getElementById('sumRate').textContent = ar ? '₹' + fmtN(ar, 2) : '—';
}

function rebuildBunkList() {
  const names = [...new Set(data.map(r => r.bunk).filter(Boolean))].sort();
  document.getElementById('bunkList').innerHTML = names.map(n => '<option value="' + n + '">').join('');
}

/* ===================== FORM CALCULATIONS ===================== */
function calcAll() {
  const amount = parseFloat(document.getElementById('f_amount').value);
  const rate = parseFloat(document.getElementById('f_rate').value);
  const qEl = document.getElementById('qtyDisplay');
  const qHid = document.getElementById('f_qty');

  let qty = null;
  if (amount > 0 && rate > 0) {
    qty = amount / rate;
    qEl.textContent = fmtN(qty, 2) + ' L';
    qHid.value = qty.toFixed(4);
  } else {
    qEl.textContent = 'Enter amount and rate';
    qHid.value = '';
  }

  const endKMEl = document.getElementById('f_endKM');
  const sk = parseFloat(document.getElementById('f_startKM').value);
  if (!editId && !endKMEl._userEdited && qty != null && !isNaN(sk)) {
    const avg = overallAvgMileage();
    if (avg) endKMEl.value = Math.round(sk + avg * qty);
  }
  
  calcTotalKM();
}

function calcTotalKM() {
  const sk = parseFloat(document.getElementById('f_startKM').value);
  const ek = parseFloat(document.getElementById('f_endKM').value);
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
    let expr = fmtI(tkm);
    if (out > 0) expr += ' + ' + fmtI(out);
    if (inc > 0) expr += ' − ' + fmtI(inc);
    eEl.textContent = expr + ' = ' + fmtI(eff) + ' km';
  } else {
    tEl.textContent = 'Enter From and To KM';
    eEl.textContent = 'Enter KM values above';
  }
}

/* ===================== MODAL OPERATIONS ===================== */
let editId = null;

function openAdd() {
  editId = null;
  document.getElementById('modalTitle').textContent = '➕ Add Fuel Entry';
  document.getElementById('saveBtn').textContent = 'Add Entry';
  resetForm();
  document.getElementById('f_date').value = new Date().toISOString().slice(0, 10);
  const latest = data.slice().sort((a, b) => (b.endKM ?? 0) - (a.endKM ?? 0)).find(r => r.endKM != null);
  if (latest) {
    document.getElementById('f_startKM').value = latest.endKM;
    calcAll();
  }
  document.getElementById('formOverlay').classList.add('open');
  document.getElementById('f_bunk').focus();
}

function openEdit(id) {
  const r = data.find(x => x.id === id);
  if (!r) return;
  editId = id;
  document.getElementById('modalTitle').textContent = '✏️ Edit Fuel Entry';
  document.getElementById('saveBtn').textContent = 'Update Entry';

  document.getElementById('f_bunk').value = r.bunk || '';
  document.getElementById('f_date').value = r.date || '';
  document.getElementById('f_amount').value = r.fuelAmount ?? '';
  document.getElementById('f_rate').value = r.fuelRate ?? '';
  document.getElementById('f_startKM').value = r.startKM ?? '';
  document.getElementById('f_endKM').value = r.endKM ?? '';
  document.getElementById('f_incomingKM').value = r.incomingKM ?? '';
  document.getElementById('f_remainKM').value = r.remainingKM ?? '';
  document.getElementById('f_projected').value = r.projected ?? '';

  calcAll();
  document.getElementById('formOverlay').classList.add('open');
  document.getElementById('f_bunk').focus();
}

function openDelete(id) {
  deleteId = id;
  document.getElementById('delOverlay').classList.add('open');
}

function confirmDelete() {
  deleteEntry(deleteId);
  closeDelete();
}

function closeDelete() {
  document.getElementById('delOverlay').classList.remove('open');
  deleteId = null;
}

function closeForm() {
  document.getElementById('formOverlay').classList.remove('open');
  editId = null;
}

function resetForm() {
  document.getElementById('entryForm').reset();
  document.getElementById('f_date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('qtyDisplay').textContent = '—';
  document.getElementById('totalKMDisplay').textContent = '—';
  document.getElementById('effectiveKMDisplay').textContent = '—';
  document.getElementById('f_endKM')._userEdited = false;
}

async function deleteEntry(id) {
  const deleted = await deleteEntryAPI(id);
  if (deleted) {
    data = data.filter(e => e.id !== id);
    render();
  }
}

/* ===================== SAVE FORM ===================== */
async function saveFormData() {
  const entry = {
    bunk: document.getElementById('f_bunk').value,
    date: document.getElementById('f_date').value,
    startKM: parseFloat(document.getElementById('f_startKM').value) || null,
    endKM: parseFloat(document.getElementById('f_endKM').value) || null,
    incomingKM: parseFloat(document.getElementById('f_incomingKM').value) || null,
    remainingKM: parseFloat(document.getElementById('f_remainKM').value) || null,
    fuelAmount: parseFloat(document.getElementById('f_amount').value) || null,
    fuelRate: parseFloat(document.getElementById('f_rate').value) || null,
    fuelQty: parseFloat(document.getElementById('f_qty').value) || null,
    projected: parseFloat(document.getElementById('f_projected').value) || null,
  };

  if (!entry.bunk || !entry.date) {
    showToast('❌ Bunk name and date required', 'error');
    return;
  }

  if (editId) {
    entry.id = editId;
    const updated = await updateEntryAPI(editId, entry);
    if (updated) {
      const idx = data.findIndex(e => e.id === editId);
      if (idx >= 0) data[idx] = entry;
      render();
      closeForm();
    }
  } else {
    entry.id = uid();
    const saved = await addEntryAPI(entry);
    if (saved) {
      data.push(entry);
      render();
      closeForm();
    }
  }
}

function saveEntry(e) {
  if (e) e.preventDefault();
  saveFormData();
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast ' + type + ' show';
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function overlayClick(e, overlayId) {
  // Intentionally disabled: modal only closes via close/cancel/update buttons
}

function closeModal() {
  closeForm();
}

/* ===================== AUTHENTICATION ===================== */
const AUTH_USERNAME = 'admin';
const AUTH_SALT     = 'TN13AK8507';
const AUTH_HASH     = '8d5999c16cb017120735dde1fcb974307c25516404d18a9abd5afb2cf6b2d595'; // Titan1987 + salt

async function hashPassword(password) {
  const data = new TextEncoder().encode(password + AUTH_SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function showApp(username) {
  currentUsername = username;
  // Save session credentials with expiration
  const today = new Date().toISOString().slice(0, 10);
  sessionStorage.setItem('loginUsername', username);
  sessionStorage.setItem('loginDate', today);
  // Password is not stored for security, but hash can be stored if needed
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainContent').style.display = 'block';
  initializeData();
}

async function submitLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!username || !password) {
    showToast('❌ Please enter username and password', 'error');
    return;
  }

  const hash = await hashPassword(password);
  if (username === AUTH_USERNAME && hash === AUTH_HASH) {
    // Save password hash for session
    sessionStorage.setItem('loginPasswordHash', hash);
    showApp(username);
  } else {
    showToast('❌ Invalid credentials', 'error');
  }
}

function logout() {
  if (confirm('Logout?')) {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainContent').style.display = 'none';
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    currentUsername = '';
    sessionStorage.removeItem('loginUsername');
    sessionStorage.removeItem('loginPasswordHash');
    sessionStorage.removeItem('loginDate');
  }
}

/* ===================== INIT ===================== */
document.addEventListener('DOMContentLoaded', () => {
  // Auto-login if session is valid and not expired
  const sessionUsername = sessionStorage.getItem('loginUsername');
  const sessionHash = sessionStorage.getItem('loginPasswordHash');
  const sessionDate = sessionStorage.getItem('loginDate');
  const today = new Date().toISOString().slice(0, 10);
  if (sessionUsername && sessionHash && sessionDate === today) {
    // Validate hash matches static credentials
    if (sessionUsername === AUTH_USERNAME && sessionHash === AUTH_HASH) {
      showApp(sessionUsername);
      return;
    }
  }
  // Otherwise, show login screen
  document.getElementById('loginScreen').classList.remove('hidden');

  const form = document.getElementById('entryForm');
  if (form) {
    form.addEventListener('change', (e) => {
      if (e.target.id === 'f_endKM') {
        document.getElementById('f_endKM')._userEdited = true;
      }
      calcAll();
    });
    form.addEventListener('input', (e) => {
      if (e.target.id === 'f_endKM') {
        document.getElementById('f_endKM')._userEdited = true;
      }
      if (e.target.id === 'f_amount' || e.target.id === 'f_rate' || e.target.id === 'f_startKM' || e.target.id === 'f_endKM') {
        calcAll();
      }
    });
  }
});
