'use strict';
// Disable non-error console output in the UI build (keep errors visible)
if (typeof console !== 'undefined') {
  console.log = console.info = console.debug = console.warn = () => {};
}

/* ===================== STORAGE & API ===================== */
// Same-origin Cloudflare Worker (worker/index.js), backed by D1. Google Sheets
// (AppsScript.js) is kept as an async backup only — see worker/index.js.
const APPS_SCRIPT_URL = '/api/data';

let currentUsername = '';
let deleteId = null;
function getUsername() { return currentUsername; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ============ AUTH TOKEN STORAGE ============
// Persisted in localStorage (not sessionStorage) so the "Add to Home Screen"
// PWA-style usage described in the README stays logged in across restarts.
// The server enforces the real expiry (see worker/index.js SESSION_TTL_MS).
function getAuthToken() { return localStorage.getItem('authToken'); }
function setAuthSession(token, username) {
  localStorage.setItem('authToken', token);
  localStorage.setItem('authUsername', username);
}
function clearAuthSession() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUsername');
}

// ============ API CALLS TO GOOGLE APPS SCRIPT ============

async function callAppsScript(action, payload = {}) {
  try {
    const url = new URL(APPS_SCRIPT_URL, window.location.origin);
    url.searchParams.append('action', action);

    const token = getAuthToken();
    const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};
    let options;

    if (action.startsWith('get')) {
      options = { method: 'GET', headers: authHeaders };
      if (payload.id) url.searchParams.append('id', payload.id);
    } else {
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8', ...authHeaders },
        body: JSON.stringify(payload)
      };
    }

    console.log(`🔗 Calling API: ${action} | URL: ${url.toString()}`);
    const response = await fetch(url.toString(), options);

    console.log(`📨 Response Status: ${response.status} ${response.statusText}`);
    console.log(`📨 Response Headers:`, response.headers);

    if (response.status === 401) {
      clearAuthSession();
      showLoginScreen();
      showToast('⚠️ Session expired. Please log in again.', 'error');
      throw new Error('Session expired');
    }

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ Response Body: ${text}`);
      throw new Error(`API Error ${response.status} ${response.statusText}: ${text.substring(0, 100)}`);
    }

    const data = await response.json();
    console.log(`✅ API Response:`, data);
    return data;
  } catch (err) {
    console.error(`❌ API Error (${action}):`, err.message);
    if (err.message !== 'Session expired') {
      showToast(`❌ Connection error: ${err.message}`, 'error');
    }
    throw err;
  }
}

// ============ API CALLS TO WORKER AUTH ENDPOINTS ============

async function authRequest(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await response.json();
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
  document.getElementById('tableBody').innerHTML =
    '<tr><td colspan="13"><div style="text-align:center;padding:48px 20px;">' +
    '<div class="spinner"></div>' +
    '<p style="color:var(--text-muted);font-size:0.85rem;">Loading data from Google Sheets…</p>' +
    '</div></td></tr>';
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
  // NO timezone manipulation - keep dates as-is
  const datePart = dateStr.split('T')[0];
  
  // Validate it's YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart;
  }
  
  return null;
}

// Format date for HTML date input (YYYY-MM-DD format)
function formatDateForInput(dateStr) {
  if (!dateStr) return '';
  
  // Extract just the date part (YYYY-MM-DD) from any format
  const datePart = dateStr.split('T')[0];
  
  // Validate it's already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart;
  }
  
  return '';
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
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    // Tiebreaker: sort by startKM descending (higher KM = more recent fill)
    return (b.startKM ?? 0) - (a.startKM ?? 0);
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
      : mil >= 12 ? `<span class="badge badge-green">${fmtN(mil, 2)}</span>`
        : mil >= 10 ? `<span class="badge badge-blue">${fmtN(mil, 2)}</span>`
          : mil >= 8 ? `<span class="badge badge-amber">${fmtN(mil, 2)}</span>`
            : `<span class="badge badge-red">${fmtN(mil, 2)}</span>`;

    return `<tr>
      <td data-label="Petrol Bunk"><div class="bunk-cell" title="${r.bunk}">${r.bunk}</div></td>
      <td data-label="Date">${fmtDate(r.date)}</td>
      <td class="num" data-label="From KM">${fmtI(r.startKM)}</td>
      <td class="num" data-label="To KM">${r.endKM != null ? fmtI(r.endKM) : '<span style="color:var(--text-light)">—</span>'}</td>
      <td class="num" data-label="Total KM">${km != null ? fmtI(km) + ' km' : '<span style="color:var(--text-light)">—</span>'}</td>
      <td data-label="Projected (km)"><span class="badge badge-blue">${fmtI(r.projected)}</span></td>
      <td class="num" data-label="Pre-fill KM">${r.incomingKM != null ? '<span class="badge badge-blue">↓ ' + fmtI(r.incomingKM) + ' km</span>' : '<span style="color:var(--text-light)">—</span>'}</td>
      <td class="num" data-label="Post-trip KM">${r.remainingKM != null ? '<span class="badge badge-amber">↑ ' + fmtI(r.remainingKM) + ' km</span>' : '<span style="color:var(--text-light)">—</span>'}</td>
      <td class="num" data-label="Amount">${fmtMon(r.fuelAmount)}</td>
      <td class="num" data-label="Fuel Rate">${fmtN(r.fuelRate, 2)}</td>
      <td class="num" data-label="Petrol (L)">${r.fuelQty != null ? fmtN(r.fuelQty, 2) + ' L' : '—'}</td>
      <td data-label="Mileage">${milCell}</td>
      <td class="cell-actions" data-label="Actions"><div class="actions">
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
  const tEl = document.getElementById('totalKMDisplay');

  if (!isNaN(sk) && !isNaN(ek) && ek >= sk) {
    const tkm = ek - sk;
    tEl.textContent = fmtI(tkm) + ' km';
  } else {
    tEl.textContent = 'Enter From and To KM';
  }
}

function getMileageColorStyle(mileageVal) {
  if (mileageVal >= 12) {
    return { bg: '#f0fdf4', border: '#86efac', text: '#16a34a' };
  } else if (mileageVal >= 10) {
    return { bg: '#eff6ff', border: '#bfdbfe', text: '#2563eb' };
  } else if (mileageVal >= 8) {
    return { bg: '#fffbeb', border: '#fcd34d', text: '#d97706' };
  } else {
    return { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626' };
  }
}

function calcMileageEdit() {
  const sk = parseFloat(document.getElementById('f_startKM').value);
  const ek = parseFloat(document.getElementById('f_endKM').value);
  const rmv = parseFloat(document.getElementById('f_remainKM').value);
  const imv = parseFloat(document.getElementById('f_incomingKM').value);
  const amount = parseFloat(document.getElementById('f_amount').value);
  const rate = parseFloat(document.getElementById('f_rate').value);
  const mileageEl = document.getElementById('f_mileage');

  let qty = null;
  if (amount > 0 && rate > 0) {
    qty = amount / rate;
  }

  if (!isNaN(sk) && !isNaN(ek) && ek >= sk && qty != null && qty > 0) {
    const tkm = ek - sk;
    const out = isNaN(rmv) ? 0 : rmv;
    const inc = isNaN(imv) ? 0 : imv;
    const eff = tkm + out - inc;
    const mileageVal = eff / qty;
    mileageEl.value = mileageVal.toFixed(2);

    const colorStyle = getMileageColorStyle(mileageVal);
    mileageEl.style.backgroundColor = colorStyle.bg;
    mileageEl.style.borderColor = colorStyle.border;
    mileageEl.style.color = colorStyle.text;
    mileageEl.style.fontWeight = '600';
  } else {
    mileageEl.value = '0';
    const colorStyle = getMileageColorStyle(0);
    mileageEl.style.backgroundColor = colorStyle.bg;
    mileageEl.style.borderColor = colorStyle.border;
    mileageEl.style.color = colorStyle.text;
    mileageEl.style.fontWeight = '600';
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
  switchModalTab('details');
  document.getElementById('tabBtnFuelTrips').disabled = true;
  document.getElementById('fuelTripsContent').innerHTML =
    '<p style="color:var(--text-muted);font-size:0.8rem;padding:12px 0;">Save this entry first to add trips.</p>';
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
  document.getElementById('f_date').value = formatDateForInput(r.date) || '';
  document.getElementById('f_amount').value = r.fuelAmount ?? '';
  document.getElementById('f_rate').value = r.fuelRate ?? '';
  document.getElementById('f_startKM').value = r.startKM ?? '';
  document.getElementById('f_endKM').value = r.endKM ?? '';
  document.getElementById('f_incomingKM').value = r.incomingKM ?? '';
  document.getElementById('f_remainKM').value = r.remainingKM ?? '';
  document.getElementById('f_projected').value = r.projected ?? '';

  calcAll();
  calcMileageEdit();
  switchModalTab('details');
  document.getElementById('tabBtnFuelTrips').disabled = false;
  renderFuelTrips(id);
  document.getElementById('formOverlay').classList.add('open');
  document.getElementById('f_bunk').focus();
}

// Switch between Fuel Details and Trips tabs in the Fuel Entry modal
function switchModalTab(tab) {
  document.getElementById('tabPaneDetails').classList.toggle('active', tab === 'details');
  document.getElementById('tabPaneTrips').classList.toggle('active', tab === 'trips');
  document.getElementById('tabBtnFuelDetails').classList.toggle('active', tab === 'details');
  document.getElementById('tabBtnFuelTrips').classList.toggle('active', tab === 'trips');
  document.getElementById('saveBtn').disabled = tab === 'trips';
  if (tab === 'trips' && editId) renderFuelTrips(editId);
}

// Look up the Petrol Bunk name for a given fuel entry id (for display in the Trip form)
function getBunkNameForFuelId(fuelId) {
  if (!fuelId) return '';
  const entry = data.find(e => String(e.id) === String(fuelId));
  return entry ? (entry.bunk || '') : '';
}

// Render the trips linked to this fuel entry (matched via Fuel_Id) inside the Trips tab
function renderFuelTrips(fuelId) {
  const container = document.getElementById('fuelTripsContent');
  const linkedTrips = trips.filter(t => String(t.Fuel_Id ?? t.fuel_Id ?? '') === String(fuelId));

  if (linkedTrips.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;padding:12px 0;">No trips recorded for this fuel entry.</p>';
    return;
  }

  const sorted = linkedTrips.slice().sort((a, b) => {
    const endA = parseFloat(a.EndKM || a.endKM) || 0;
    const endB = parseFloat(b.EndKM || b.endKM) || 0;
    return endB - endA;
  });

  container.innerHTML = `
    <table class="fuel-trips-table">
      <thead>
        <tr><th>Date</th><th>From KM</th><th>To KM</th><th>Distance</th><th>To Go KM</th><th>Diff</th><th>Notes</th></tr>
      </thead>
      <tbody>
        ${sorted.map(t => {
          const tripDate = t.Date || t.date || '';
          const startKM = parseFloat(t.StartKM || t.startKM) || 0;
          const endKM = parseFloat(t.EndKM || t.endKM) || 0;
          const distance = parseFloat(t.Distance || t.distance) || 0;
          const toGoKM = t.ToGoKM !== undefined && t.ToGoKM !== null && t.ToGoKM !== '' ? parseFloat(t.ToGoKM) : (t.toGoKM !== undefined && t.toGoKM !== null && t.toGoKM !== '' ? parseFloat(t.toGoKM) : null);
          const diff = t.Diff !== undefined && t.Diff !== null && t.Diff !== '' ? parseFloat(t.Diff) : (t.diff !== undefined && t.diff !== null && t.diff !== '' ? parseFloat(t.diff) : null);
          const notes = t.Notes || t.notes || '';
          return `<tr>
            <td>${tripDate ? new Date(tripDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
            <td>${startKM.toLocaleString()}</td>
            <td>${endKM.toLocaleString()}</td>
            <td>${distance} km</td>
            <td>${toGoKM !== null ? toGoKM.toLocaleString() + ' km' : '—'}</td>
            <td>${diff !== null ? diffBadge(diff) : '—'}</td>
            <td>${notes || '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
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

  const mileageEl = document.getElementById('f_mileage');
  mileageEl.value = '0';
  const colorStyle = getMileageColorStyle(0);
  mileageEl.style.backgroundColor = colorStyle.bg;
  mileageEl.style.borderColor = colorStyle.border;
  mileageEl.style.color = colorStyle.text;
  mileageEl.style.fontWeight = '600';

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

/* ===================== TRIP DATA MANAGEMENT ===================== */

let trips = [];
let currentView = 'home'; // 'home' or 'trips'
let tripEditId = null;
let tripDeleteId = null;
let lastTripToGoKM = null; // ToGoKM from the most recent trip, used to auto-populate new entries

// API call helper for trips
async function callTripsAPI(action, payload = {}) {
  try {
    const url = new URL(APPS_SCRIPT_URL, window.location.origin);
    url.searchParams.append('action', action);
    url.searchParams.append('sheet', 'Trips'); // Use 'Trips' sheet for trip data

    const token = getAuthToken();
    const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};
    let options;

    if (action.startsWith('get')) {
      // GET request
      options = { method: 'GET', headers: authHeaders };
      if (payload.id) url.searchParams.append('id', payload.id);
    } else {
      // POST request
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8', ...authHeaders },
        body: JSON.stringify(payload)
      };
    }

    console.log(`🔗 Calling Trips API: ${action} | URL: ${url.toString()}`);
    const response = await fetch(url.toString(), options);

    console.log(`📨 Response Status: ${response.status} ${response.statusText}`);
    console.log(`📨 Response Headers:`, response.headers);

    if (response.status === 401) {
      clearAuthSession();
      showLoginScreen();
      showToast('⚠️ Session expired. Please log in again.', 'error');
      throw new Error('Session expired');
    }

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ Response Body: ${text}`);
      throw new Error(`API Error ${response.status} ${response.statusText}: ${text.substring(0, 100)}`);
    }

    const data = await response.json();
    console.log(`✅ Trips API Response:`, data);
    return data;
  } catch (err) {
    console.error(`❌ Trips API Error (${action}):`, err.message);
    if (err.message !== 'Session expired') {
      showToast(`❌ Error: ${err.message}`, 'error');
    }
    throw err;
  }
}

// Load trips from Google Sheets
// Load trips from Google Sheets (called once on app init, then after add/edit/delete)
async function loadTrips() {
  document.getElementById('tripTableBody').innerHTML =
    '<tr><td colspan="7"><div style="text-align:center;padding:48px 20px;">' +
    '<div class="spinner"></div>' +
    '<p style="color:var(--text-muted);font-size:0.85rem;">Refreshing trips…</p>' +
    '</div></td></tr>';
  try {
    console.log('📡 Refreshing trips from Google Sheets...');
    const result = await callTripsAPI('get');
    if (result.success) {
      trips = result.data || [];
      console.log('✓ Trips loaded:', trips.length, 'records');
      renderTrips();
    } else {
      throw new Error(result.error || 'Failed to load trips');
    }
  } catch (err) {
    console.error('❌ Error loading trips:', err.message);
    showToast('⚠️ Failed to refresh trips. Check connection.', 'error');
    trips = [];
    renderTrips();
  }
}

// Open Add Trip modal
async function openAddTrip() {
  tripEditId = null;
  document.getElementById('tripModalTitle').textContent = 'Add Trip';
  document.getElementById('saveTripBtn').textContent = '✓ Save Trip';
  resetTripForm();

  // Auto-populate Start KM and To Go KM from the most recent trip
  const latestTrip = trips.slice().sort((a, b) => {
    const endA = parseFloat(a.EndKM || a.endKM) || 0;
    const endB = parseFloat(b.EndKM || b.endKM) || 0;
    return endB - endA;
  }).find(t => (parseFloat(t.EndKM || t.endKM) || 0) > 0);
  if (latestTrip) {
    document.getElementById('trip_startKM').value = parseFloat(latestTrip.EndKM || latestTrip.endKM) || '';
    const prevToGoKM = parseFloat(latestTrip.ToGoKM || latestTrip.toGoKM);
    lastTripToGoKM = !isNaN(prevToGoKM) ? prevToGoKM : null;
  } else {
    lastTripToGoKM = null;
  }
  document.getElementById('trip_toGoKM')._userEdited = false;
  calcTripDistance();

  // Fetch and populate the latest Fuel ID
  try {
    const result = await callAppsScript('getLastFuelId');
    if (result.success && result.lastFuelId) {
      document.getElementById('trip_fuelId').value = result.lastFuelId;
      document.getElementById('trip_fuelBunk').value = getBunkNameForFuelId(result.lastFuelId);
    }
  } catch (err) {
    console.error('Error fetching last fuel ID:', err.message);
  }

  document.getElementById('tripFormOverlay').classList.add('open');
}

// Open Edit Trip modal
function openEditTrip(id) {
  const trip = trips.find(t => t.id === id);
  if (!trip) return;

  tripEditId = id;
  document.getElementById('tripModalTitle').textContent = 'Edit Trip';
  document.getElementById('saveTripBtn').textContent = '✓ Update Trip';

  // Handle both field name variations (capital and lowercase)
  const fuelId = trip.Fuel_Id || trip.fuel_Id || '';
  const startKM = parseFloat(trip.StartKM || trip.startKM) || 0;
  const endKM = parseFloat(trip.EndKM || trip.endKM) || 0;
  const distance = parseFloat(trip.Distance || trip.distance) || 0;
  const toGoKM = parseFloat(trip.ToGoKM || trip.toGoKM) || 0;
  const tripDate = trip.Date || trip.date || '';
  const notes = trip.Notes || trip.notes || '';

  // Use formatDateForInput to ensure proper YYYY-MM-DD format
  document.getElementById('trip_fuelId').value = fuelId;
  document.getElementById('trip_fuelBunk').value = getBunkNameForFuelId(fuelId);
  document.getElementById('trip_date').value = formatDateForInput(tripDate);
  document.getElementById('trip_startKM').value = startKM;
  document.getElementById('trip_endKM').value = endKM;
  document.getElementById('trip_distance').value = distance;
  document.getElementById('tripDistanceDisplay').textContent = distance + ' km';
  // For toGoKM: only use empty string if it's actually 0, otherwise show the value
  document.getElementById('trip_toGoKM').value = toGoKM > 0 ? toGoKM : '';
  document.getElementById('trip_toGoKM')._userEdited = true;
  console.log('✏️ Edit mode - toGoKM value:', toGoKM, '| Field set to:', document.getElementById('trip_toGoKM').value);
  const diff = trip.Diff !== undefined && trip.Diff !== null && trip.Diff !== '' ? trip.Diff : (trip.diff !== undefined && trip.diff !== null && trip.diff !== '' ? trip.diff : '');
  document.getElementById('trip_diff').value = diff;
  document.getElementById('trip_notes').value = notes;

  document.getElementById('tripFormOverlay').classList.add('open');
}

// Close Trip modal
function closeTripModal() {
  document.getElementById('tripFormOverlay').classList.remove('open');
  resetTripForm();
  tripEditId = null;
}

// Reset Trip form
function resetTripForm() {
  document.getElementById('tripForm').reset();
  document.getElementById('trip_date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('tripDistanceDisplay').textContent = '0 km';
  document.getElementById('trip_distance').value = '0';
  document.getElementById('trip_fuelId').value = '';
  document.getElementById('trip_fuelBunk').value = '';
  document.getElementById('trip_toGoKM').value = '';
  document.getElementById('trip_toGoKM')._userEdited = false;
  document.getElementById('trip_diff').value = '';
}

// Calculate distance
function calcTripDistance() {
  const startKM = parseFloat(document.getElementById('trip_startKM').value) || 0;
  const endKM = parseFloat(document.getElementById('trip_endKM').value) || 0;
  const distance = Math.max(0, endKM - startKM);

  document.getElementById('trip_distance').value = distance;
  document.getElementById('tripDistanceDisplay').textContent = distance + ' km';

  // Auto-update To Go KM (previous trip's remaining km minus this trip's distance),
  // unless the user has manually edited the field
  const toGoKMEl = document.getElementById('trip_toGoKM');
  if (!toGoKMEl._userEdited && lastTripToGoKM != null) {
    toGoKMEl.value = Math.max(0, lastTripToGoKM - distance);
  }
}

// Save Trip Entry
async function saveTripEntry(e) {
  if (e) e.preventDefault();

  const date = document.getElementById('trip_date').value;
  const fuelId = document.getElementById('trip_fuelId').value.trim();
  const startKM = parseFloat(document.getElementById('trip_startKM').value);
  const endKM = parseFloat(document.getElementById('trip_endKM').value);
  const distance = parseFloat(document.getElementById('trip_distance').value);
  const toGoKMValue = document.getElementById('trip_toGoKM').value.trim();
  const toGoKM = toGoKMValue !== '' ? parseFloat(toGoKMValue) : null;
  const diffValue = document.getElementById('trip_diff').value.trim();
  const diff = diffValue !== '' ? parseFloat(diffValue) : null;
  const notes = document.getElementById('trip_notes').value.trim();

  console.log('📝 Trip data to save:', { date, fuelId, startKM, endKM, distance, toGoKM, diff, notes });
  console.log('🔍 toGoKM details - Raw value:', document.getElementById('trip_toGoKM').value, '| Trimmed:', toGoKMValue, '| Parsed:', toGoKM);

  if (!date || !startKM || !endKM) {
    showToast('❌ Date, Start KM, and End KM are required', 'error');
    return;
  }

  // Fall back to the latest Fuel entry's id if Fuel_Id is missing/blank
  let resolvedFuelId = fuelId;
  if (!resolvedFuelId) {
    try {
      const result = await callAppsScript('getLastFuelId');
      if (result.success && result.lastFuelId) {
        resolvedFuelId = result.lastFuelId;
        console.log('ℹ️ Fuel_Id was empty - using latest Fuel entry id:', resolvedFuelId);
      }
    } catch (err) {
      console.error('Error fetching last fuel ID:', err.message);
    }
  }

  try {
    if (tripEditId) {
      // Update existing trip - match sheet headers exactly
      const updates = { Fuel_Id: resolvedFuelId, Date: date, StartKM: startKM, EndKM: endKM, Distance: distance, Notes: notes };
      if (toGoKM !== null) {
        updates.ToGoKM = toGoKM;
        console.log('✏️ Updating ToGoKM:', toGoKM);
      }
      if (diff !== null) {
        updates.Diff = diff;
        console.log('✏️ Updating Diff:', diff);
      }
      console.log('📤 API Update payload:', updates);
      const result = await callTripsAPI('update', { id: tripEditId, updates });
      if (result.success) {
        closeTripModal();
        showToast('✓ Trip updated', 'success');
        loadTrips();
      } else {
        showToast('❌ Failed to update trip: ' + result.error, 'error');
      }
    } else {
      // Add new trip - use capital letters to match sheet headers
      const newTrip = {
        id: uid(),
        Fuel_Id: resolvedFuelId,
        Date: date,
        StartKM: startKM,
        EndKM: endKM,
        Distance: distance,
        ToGoKM: toGoKM,
        Diff: diff,
        Notes: notes
      };
      console.log('📤 API Add payload:', newTrip);
      const result = await callTripsAPI('add', { entry: newTrip });
      if (result.success) {
        closeTripModal();
        showToast('✓ Trip added', 'success');
        loadTrips();
      } else {
        showToast('❌ Failed to save trip: ' + result.error, 'error');
      }
    }
  } catch (err) {
    console.error('❌ Error saving trip:', err.message);
    showToast('❌ Error: ' + err.message, 'error');
  }
}

// Delete Trip
function openDeleteTrip(id) {
  tripDeleteId = id;
  document.getElementById('tripDelOverlay').classList.add('open');
}

function closeTripDelete() {
  document.getElementById('tripDelOverlay').classList.remove('open');
  tripDeleteId = null;
}

async function confirmTripDelete() {
  if (tripDeleteId) {
    try {
      const result = await callTripsAPI('delete', { id: tripDeleteId });
      if (result.success) {
        showToast('✓ Trip deleted', 'success');
        await loadTrips();
        closeTripDelete();
      } else {
        showToast('❌ Failed to delete trip: ' + result.error, 'error');
      }
    } catch (err) {
      console.error('❌ Error deleting trip:', err.message);
      showToast('❌ Error: ' + err.message, 'error');
    }
  }
}

// Color-coded badge for the Diff column, indicating mileage saved/lost
function diffBadge(diff) {
  const badgeClass = diff <= 0 ? 'badge-green' : diff <= 5 ? 'badge-amber' : diff < 10 ? 'badge-orange' : 'badge-red';
  return `<span class="badge ${badgeClass}">${diff.toLocaleString()}</span>`;
}

// Render Trips Table (uses cached trips data from memory)
function renderTrips() {
  const tbody = document.getElementById('tripTableBody');

  if (trips.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">No trips recorded yet. Add one to get started.</td></tr>';
    return;
  }

  const sortedTrips = [...trips].sort((a, b) => {
    const endA = parseFloat(a.EndKM || a.endKM) || 0;
    const endB = parseFloat(b.EndKM || b.endKM) || 0;
    return endB - endA;
  });

  tbody.innerHTML = sortedTrips.map(trip => {
    // Handle both field name variations (capital and lowercase)
    const startKM = parseFloat(trip.StartKM || trip.startKM) || 0;
    const endKM = parseFloat(trip.EndKM || trip.endKM) || 0;
    const distance = parseFloat(trip.Distance || trip.distance) || 0;
    const toGoKM = trip.ToGoKM !== undefined && trip.ToGoKM !== null && trip.ToGoKM !== '' ? parseFloat(trip.ToGoKM) : (trip.toGoKM !== undefined && trip.toGoKM !== null && trip.toGoKM !== '' ? parseFloat(trip.toGoKM) : null);
    const diff = trip.Diff !== undefined && trip.Diff !== null && trip.Diff !== '' ? parseFloat(trip.Diff) : (trip.diff !== undefined && trip.diff !== null && trip.diff !== '' ? parseFloat(trip.diff) : null);
    const tripDate = trip.Date || trip.date || '';
    const notes = trip.Notes || trip.notes || '';

    return `
    <tr>
      <td data-label="Date">${tripDate ? new Date(tripDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
      <td class="num" data-label="Start KM">${startKM.toLocaleString()}</td>
      <td class="num" data-label="End KM">${endKM.toLocaleString()}</td>
      <td class="num" data-label="Distance"><strong>${distance}</strong> km</td>
      <td class="num" data-label="To Go KM">${toGoKM !== null ? toGoKM.toLocaleString() + ' km' : '—'}</td>
      <td class="num" data-label="Diff">${diff !== null ? diffBadge(diff) : '—'}</td>
      <td class="notes-cell" data-label="Notes">${notes || '—'}</td>
      <td class="cell-actions" data-label="Actions">
        <div class="actions">
          <button class="btn btn-sm btn-icon-edit" onclick="openEditTrip('${trip.id}')" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-sm btn-icon-del" onclick="openDeleteTrip('${trip.id}')" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `;
  }).join('');
}

// Switch Views
function switchToHome() {
  currentView = 'home';
  document.getElementById('mainContent').style.display = 'block';
  document.getElementById('tripContent').style.display = 'none';
  document.getElementById('tripsToggleBtn').innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 3H5a2 2 0 00-2 2v4m0 0H3m2 0v16a2 2 0 002 2h12a2 2 0 002-2v-6m0 0h2m-2 0v-4m0 0V5a2 2 0 00-2-2h-4m0 16H9m3-13v6m3-6v6"/></svg>Trip Data';
  document.getElementById('addEntryBtn').innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>Add Entry';
}

function switchToTrips() {
  currentView = 'trips';
  document.getElementById('mainContent').style.display = 'none';
  document.getElementById('tripContent').style.display = 'block';
  document.getElementById('tripsToggleBtn').innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back';
  document.getElementById('addEntryBtn').innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>New Trip';
  // Use cached trips data - no need to reload every time
  renderTrips();
}

function handleAddClick() {
  if (currentView === 'trips') {
    openAddTrip();
  } else {
    openAdd();
  }
}

function toggleTripsView() {
  if (currentView === 'trips') {
    switchToHome();
  } else {
    switchToTrips();
  }
}

/* ===================== AUTHENTICATION ===================== */

function showAuthPanel(which) {
  const isRegister = which === 'register';
  document.getElementById('loginPanel').classList.toggle('hidden', isRegister);
  document.getElementById('registerPanel').classList.toggle('hidden', !isRegister);
  document.getElementById('authTitle').textContent = isRegister ? 'Create Account' : 'Car Mileage Tracker';
  document.getElementById('authSubtitle').textContent = isRegister
    ? 'Register to start tracking your own fuel and mileage data.'
    : 'Track your fuel consumption and mileage. Sign in to access your data.';
}

function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('mainContent').style.display = 'none';
  document.getElementById('tripContent').style.display = 'none';
  showAuthPanel('login');
}

async function showApp(username) {
  currentUsername = username;
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainContent').style.display = 'block';
  document.getElementById('tripContent').style.display = 'none';
  currentView = 'home';
  initializeData();
  // Load trips once on app initialization (data is cached and reused until add/edit/delete)
  loadTrips();
}

async function submitLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!username || !password) {
    showToast('❌ Please enter username and password', 'error');
    return;
  }

  const result = await authRequest('/api/auth/login', { username, password });
  if (result.success) {
    setAuthSession(result.token, result.username);
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    showApp(result.username);
  } else {
    showToast(`❌ ${result.error || 'Invalid credentials'}`, 'error');
  }
}

async function submitRegister() {
  const username = document.getElementById('registerUsername').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirmPassword = document.getElementById('registerConfirmPassword').value;

  if (!username || !password || !confirmPassword) {
    showToast('❌ Please fill in all fields', 'error');
    return;
  }
  if (password !== confirmPassword) {
    showToast('❌ Passwords do not match', 'error');
    return;
  }

  const result = await authRequest('/api/auth/register', { username, password });
  if (result.success) {
    document.getElementById('registerUsername').value = '';
    document.getElementById('registerPassword').value = '';
    document.getElementById('registerConfirmPassword').value = '';
    showToast('✅ Account created! Please log in.', 'success');
    showAuthPanel('login');
    document.getElementById('loginUsername').value = result.username;
    document.getElementById('loginPassword').focus();
  } else {
    showToast(`❌ ${result.error || 'Registration failed'}`, 'error');
  }
}

function logout() {
  if (confirm('Logout?')) {
    const token = getAuthToken();
    if (token) {
      fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }).catch(() => {});
    }
    clearAuthSession();
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    currentUsername = '';
    currentView = 'home';
    showLoginScreen();
  }
}

/* ===================== INIT ===================== */
document.addEventListener('DOMContentLoaded', async () => {
  // Auto-login if a stored session token is still valid server-side
  const token = getAuthToken();
  let autoLoggedIn = false;
  if (token) {
    try {
      const response = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
      const result = await response.json();
      if (result.success) {
        showApp(result.username);
        autoLoggedIn = true;
      } else {
        clearAuthSession();
      }
    } catch {
      // Network error on startup check: fall through to the login screen.
    }
  }
  if (!autoLoggedIn) {
    showLoginScreen();
  }

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

  const tripForm = document.getElementById('tripForm');
  if (tripForm) {
    tripForm.addEventListener('input', (e) => {
      if (e.target.id === 'trip_toGoKM') {
        e.target._userEdited = true;
      }
    });
  }
});
