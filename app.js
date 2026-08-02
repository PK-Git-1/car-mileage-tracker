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
    const token = getAuthToken();
    const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

    // Special handling for 'me' action — calls /api/auth/me
    if (action === 'me') {
      const response = await fetch('/api/auth/me', {
        method: 'GET',
        headers: authHeaders
      });
      if (!response.ok) {
        if (response.status === 401) {
          clearAuthSession();
          showLoginScreen();
        }
        throw new Error(`API Error ${response.status}`);
      }
      return await response.json();
    }

    const url = new URL(APPS_SCRIPT_URL, window.location.origin);
    url.searchParams.append('action', action);

    let options;

    if (action.startsWith('get')) {
      options = { method: 'GET', headers: authHeaders };
      if (payload.id) url.searchParams.append('id', payload.id);
      if (payload.sheet) url.searchParams.append('sheet', payload.sheet);
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
    console.log(`📡 Fetching data for vehicle: ${currentVehicleId}`);
    const result = await callAppsScript('get');
    if (result.success) {
      let json = result.data || [];

      // Filter entries by current vehicle
      json = json.filter(entry => entry.vehicle_id === currentVehicleId || !entry.vehicle_id);
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
let history = [];
let historyIndex = -1;

function saveToHistory() {
  historyIndex++;
  history = history.slice(0, historyIndex);
  history.push(JSON.parse(JSON.stringify(data)));
  if (history.length > 50) {
    history.shift();
    historyIndex--;
  }
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    data = JSON.parse(JSON.stringify(history[historyIndex]));
    render();
    showToast('↶ Undo successful', 'success');
  } else {
    showToast('❌ Nothing to undo', 'error');
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    data = JSON.parse(JSON.stringify(history[historyIndex]));
    render();
    showToast('↷ Redo successful', 'success');
  } else {
    showToast('❌ Nothing to redo', 'error');
  }
}

async function initializeData() {
  document.getElementById('tableBody').innerHTML =
    '<tr><td colspan="13"><div style="text-align:center;padding:48px 20px;">' +
    '<div class="spinner"></div>' +
    '<p style="color:var(--text-muted);font-size:0.85rem;">Loading data…</p>' +
    '</div></td></tr>';

  await initializeVehicles();
  data = await loadDataFromAPI();
  console.log(`Loaded ${data.length} entries`);
  saveToHistory();
  render();
}

/* ===================== SORT & FILTER ===================== */
let sortKey = 'date', sortAsc = false;
let filteredData = [];

function sortBy(key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else { sortKey = key; sortAsc = false; }
  applyFilters();
}

function applyFilters() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo = document.getElementById('filterDateTo').value;

  filteredData = data.filter(r => {
    const bunkMatch = (r.bunk || '').toLowerCase().includes(searchTerm);
    const dateMatch = (!dateFrom || (r.date && r.date >= dateFrom)) && (!dateTo || (r.date && r.date <= dateTo));
    return bunkMatch && dateMatch;
  });

  renderTable();
}

function clearFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  filteredData = [...data];
  renderTable();
}

function renderTable() {
  const sorted = [...filteredData].sort((a, b) => {
    let va, vb;
    if (sortKey === 'totalKM') { va = totalKM(a); vb = totalKM(b); }
    else if (sortKey === 'mileage') { va = mileage(a); vb = mileage(b); }
    else { va = a[sortKey]; vb = b[sortKey]; }
    const nv = sortAsc ? Infinity : -Infinity;
    va = va ?? nv;
    vb = vb ?? nv;
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return (b.startKM ?? 0) - (a.startKM ?? 0);
  });

  document.querySelectorAll('thead th').forEach(th => th.classList.remove('sorted'));
  const ath = document.getElementById('th-' + sortKey);
  if (ath) ath.classList.add('sorted');

  const tbody = document.getElementById('tableBody');
  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="13"><div style="text-align:center;padding:40px 20px;"><p style="color:var(--text-muted);margin-bottom:20px;">No entries found.</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = sorted.map(r => {
    const km = totalKM(r);
    const mil = r.mileage ?? null;
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
  if (!data.length) {
    document.getElementById('tableBody').innerHTML = '<tr><td colspan="13"><div style="text-align:center;padding:40px 20px;"><p style="color:var(--text-muted);margin-bottom:20px;">No entries yet.</p><button class="btn btn-primary" onclick="openAdd()">➕ Add First Entry</button></div></td></tr>';
    updateSummary();
    checkAndDisplayAlerts();
    return;
  }

  filteredData = [...data];
  renderTable();
  document.getElementById('countLabel').textContent = data.length + ' record' + (data.length !== 1 ? 's' : '');
  updateSummary();
  rebuildBunkList();
  checkAndDisplayAlerts();
  if (currentView === 'analytics') updateCharts();
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

  calcProjectedKM();
  calcTotalKM();
}

function calcProjectedKM() {
  if (editId) return;

  const qty = parseFloat(document.getElementById('f_qty').value);
  const projectedEl = document.getElementById('f_projected');

  if (!isNaN(qty) && qty > 0) {
    const avg = overallAvgMileage();
    if (avg && avg > 0) {
      const projected = Math.round(qty * avg);
      projectedEl.value = projected;
    }
  }
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

  // Calculate trip summary stats
  const totalTripDistance = sorted.reduce((sum, t) => sum + (parseFloat(t.Distance || t.distance) || 0), 0);
  const avgTripMileage = sorted.reduce((sum, t) => sum + (t.Mileage ?? 0), 0) / sorted.length || 0;
  const fuelEntry = data.find(e => String(e.id) === String(fuelId));
  const costPerTrip = fuelEntry ? (fuelEntry.fuelAmount || 0) / Math.max(1, sorted.length) : 0;

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 16px;">
      <div class="stat-card" style="padding: 10px 12px;">
        <div class="stat-label" style="margin-bottom: 6px;">Total Trip Distance</div>
        <div style="font-size: 1.1rem; font-weight: 700; color: var(--text);">${fmtI(totalTripDistance)} km</div>
      </div>
      <div class="stat-card" style="padding: 10px 12px;">
        <div class="stat-label" style="margin-bottom: 6px;">Avg Mileage</div>
        <div style="font-size: 1.1rem; font-weight: 700; color: var(--success);">${fmtN(avgTripMileage, 2)} km/L</div>
      </div>
      <div class="stat-card" style="padding: 10px 12px;">
        <div class="stat-label" style="margin-bottom: 6px;">Cost per Trip</div>
        <div style="font-size: 1.1rem; font-weight: 700; color: var(--text);">₹${fmtN(costPerTrip, 2)}</div>
      </div>
    </div>

    <table class="fuel-trips-table">
      <thead>
        <tr><th>Date</th><th>From KM</th><th>To KM</th><th>Distance</th><th>To Go KM</th><th>Diff</th><th>Mileage</th><th>Category</th><th>Notes</th></tr>
      </thead>
      <tbody>
        ${sorted.map(t => {
          const tripDate = t.Date || t.date || '';
          const startKM = parseFloat(t.StartKM || t.startKM) || 0;
          const endKM = parseFloat(t.EndKM || t.endKM) || 0;
          const distance = parseFloat(t.Distance || t.distance) || 0;
          const toGoKM = t.ToGoKM !== undefined && t.ToGoKM !== null && t.ToGoKM !== '' ? parseFloat(t.ToGoKM) : (t.toGoKM !== undefined && t.toGoKM !== null && t.toGoKM !== '' ? parseFloat(t.toGoKM) : null);
          const diff = t.Diff !== undefined && t.Diff !== null && t.Diff !== '' ? parseFloat(t.Diff) : (t.diff !== undefined && t.diff !== null && t.diff !== '' ? parseFloat(t.diff) : null);
          const tripMil = t.Mileage ?? null;
          const category = t.Category || t.category || '';
          const notes = t.Notes || t.notes || '';
          return `<tr>
            <td>${tripDate ? new Date(tripDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
            <td>${startKM.toLocaleString()}</td>
            <td>${endKM.toLocaleString()}</td>
            <td>${distance} km</td>
            <td>${toGoKM !== null ? toGoKM.toLocaleString() + ' km' : '—'}</td>
            <td>${diff !== null ? diffBadge(diff) : '—'}</td>
            <td>${mileageBadge(tripMil)}</td>
            <td>${getCategoryBadge(category)}</td>
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
    saveToHistory();
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
    vehicle_id: currentVehicleId,
  };

  if (!entry.bunk || !entry.date) {
    showToast('❌ Bunk name and date required', 'error');
    return;
  }

  if (editId) {
    entry.id = editId;
    const calcMil = mileage(entry);
    entry.mileage = calcMil != null ? parseFloat(calcMil.toFixed(2)) : null;
    const updated = await updateEntryAPI(editId, entry);
    if (updated) {
      const idx = data.findIndex(e => e.id === editId);
      if (idx >= 0) data[idx] = entry;
      saveToHistory();
      render();
      closeForm();
    }
  } else {
    entry.id = uid();
    const calcMil = mileage(entry);
    entry.mileage = calcMil != null ? parseFloat(calcMil.toFixed(2)) : null;
    const saved = await addEntryAPI(entry);
    if (saved) {
      data.push(entry);
      saveToHistory();
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
let currentView = 'home'; // 'home', 'trips', or 'analytics'
let tripEditId = null;
let tripDeleteId = null;
let lastTripToGoKM = null; // ToGoKM from the most recent trip, used to auto-populate new entries

/* ===================== VEHICLE MANAGEMENT ===================== */
let vehicles = [];
let currentVehicleId = null;
let vehicleEditId = null;

async function initializeVehicles() {
  try {
    // Fetch vehicles from backend
    const result = await callAppsScript('get', { sheet: 'Vehicles' });
    if (result.success) {
      vehicles = result.data.filter(v => !v.isArchived);
    }

    // Get current vehicle ID from user profile
    const meResult = await callAppsScript('me');
    if (meResult.success && meResult.lastVehicleId) {
      currentVehicleId = meResult.lastVehicleId;
      // Verify it still exists and is not archived
      const exists = vehicles.find(v => v.id === currentVehicleId);
      if (!exists) {
        currentVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
        if (currentVehicleId) await setCurrentVehicle(currentVehicleId);
      }
    } else if (vehicles.length > 0) {
      currentVehicleId = vehicles[0].id;
      await setCurrentVehicle(currentVehicleId);
    }
  } catch (err) {
    console.error('Failed to initialize vehicles:', err);
    showToast('❌ Failed to load vehicles', 'error');
  }
  populateVehicleSelector();
}

async function setCurrentVehicle(vehicleId) {
  try {
    const result = await fetch('/api/auth/setCurrentVehicle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({ vehicleId })
    });
    const data = await result.json();
    if (data.success) {
      currentVehicleId = vehicleId;
    }
  } catch (err) {
    console.error('Failed to set current vehicle:', err);
  }
}

function populateVehicleSelector() {
  const selector = document.getElementById('vehicleSelector');
  selector.innerHTML = vehicles.map(v => `
    <option value="${v.id}" ${v.id === currentVehicleId ? 'selected' : ''}>${v.name}</option>
  `).join('');
  if (vehicles.length === 0) {
    selector.innerHTML = '<option value="">No vehicles - Add one first</option>';
  }
}

async function switchVehicle() {
  const vehicleId = document.getElementById('vehicleSelector').value;
  if (vehicleId) {
    await setCurrentVehicle(vehicleId);
    render();
  }
}

function openVehicleManager() {
  document.getElementById('vehiclesList').innerHTML = `
    <div style="display: grid; gap: 12px;">
      ${vehicles.length === 0 ? '<p style="color: var(--text-muted); text-align: center; padding: 20px;">No vehicles yet. Add your first vehicle!</p>' : ''}
      ${vehicles.map(v => `
        <div style="background: var(--bg); padding: 12px; border-radius: 8px; border: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700;">${v.name}</div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">${v.model || 'No model'} • ${v.plate || 'No plate'}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm btn-icon-edit" onclick="editVehicle('${v.id}')">✏️</button>
            <button class="btn btn-sm btn-icon-del" onclick="deleteVehicle('${v.id}')">🗑️</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('vehicleManagerOverlay').classList.add('open');
}

function closeVehicleManager() {
  document.getElementById('vehicleManagerOverlay').classList.remove('open');
}

function openAddVehicle() {
  vehicleEditId = null;
  document.getElementById('vehicleFormTitle').textContent = 'Add Vehicle';
  document.getElementById('vehicleForm').reset();
  document.getElementById('vehicleFormOverlay').classList.add('open');
}

function editVehicle(vehicleId) {
  const vehicle = vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return;

  vehicleEditId = vehicleId;
  document.getElementById('vehicleFormTitle').textContent = 'Edit Vehicle';
  document.getElementById('vf_name').value = vehicle.name;
  document.getElementById('vf_model').value = vehicle.model || '';
  document.getElementById('vf_plate').value = vehicle.plate || '';
  document.getElementById('vehicleFormOverlay').classList.add('open');
}

async function saveVehicle() {
  const name = document.getElementById('vf_name').value.trim();
  const model = document.getElementById('vf_model').value.trim();
  const plate = document.getElementById('vf_plate').value.trim();

  if (!name) {
    showToast('❌ Vehicle name required', 'error');
    return;
  }

  try {
    if (vehicleEditId) {
      // Update vehicle
      const result = await callAppsScript('update', {
        sheet: 'Vehicles',
        id: vehicleEditId,
        updates: { name, model, plate, updated_at: new Date().toISOString() }
      });
      if (result.success) {
        showToast('✓ Vehicle updated', 'success');
      } else {
        showToast('❌ Failed to update vehicle', 'error');
        return;
      }
    } else {
      // Add new vehicle
      const vehicle = {
        id: crypto.randomUUID ? crypto.randomUUID() : uid(),
        name,
        model,
        plate,
        isArchived: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const result = await callAppsScript('add', { sheet: 'Vehicles', entry: vehicle });
      if (result.success) {
        showToast('✓ Vehicle added', 'success');
      } else {
        showToast('❌ Failed to add vehicle', 'error');
        return;
      }
    }

    await initializeVehicles();
    populateVehicleSelector();
    closeVehicleForm();
    openVehicleManager();
  } catch (err) {
    console.error('Error saving vehicle:', err);
    showToast('❌ Error saving vehicle', 'error');
  }
}

async function deleteVehicle(vehicleId) {
  if (confirm('Archive this vehicle? Historical data will be preserved.')) {
    try {
      // Archive the vehicle instead of deleting
      const result = await callAppsScript('update', {
        sheet: 'Vehicles',
        id: vehicleId,
        updates: { isArchived: 1, updated_at: new Date().toISOString() }
      });
      if (result.success) {
        if (currentVehicleId === vehicleId) {
          const remaining = vehicles.filter(v => v.id !== vehicleId);
          currentVehicleId = remaining.length > 0 ? remaining[0].id : null;
          if (currentVehicleId) await setCurrentVehicle(currentVehicleId);
        }
        await initializeVehicles();
        populateVehicleSelector();
        showToast('✓ Vehicle archived', 'success');
        openVehicleManager();
      } else {
        showToast('❌ Failed to archive vehicle', 'error');
      }
    } catch (err) {
      console.error('Error archiving vehicle:', err);
      showToast('❌ Error archiving vehicle', 'error');
    }
  }
}

function closeVehicleForm() {
  document.getElementById('vehicleFormOverlay').classList.remove('open');
  vehicleEditId = null;
}

/* ===================== DARK MODE ===================== */

function initializeDarkMode() {
  const savedMode = localStorage.getItem('darkMode');
  if (savedMode === 'true' || (!savedMode && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.body.classList.add('dark-mode');
    updateDarkModeButton();
  }
}

function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const isDarkMode = document.body.classList.contains('dark-mode');
  localStorage.setItem('darkMode', isDarkMode);
  updateDarkModeButton();
}

function updateDarkModeButton() {
  const btn = document.getElementById('darkModeBtn');
  if (document.body.classList.contains('dark-mode')) {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="5"/><path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m3.08 3.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m3.08-3.08l4.24-4.24"/></svg>';
  } else {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
}

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
  const category = trip.Category || trip.category || '';
  document.getElementById('trip_category').value = category;
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
  document.getElementById('trip_category').value = '';
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
  const category = document.getElementById('trip_category').value.trim();
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

  const linkedFuelEntry = data.find(e => String(e.id) === String(resolvedFuelId));
  const rawMil = linkedFuelEntry ? (linkedFuelEntry.mileage != null ? linkedFuelEntry.mileage : mileage(linkedFuelEntry)) : null;
  const tripMileage = rawMil != null ? parseFloat(rawMil.toFixed(2)) : null;

  try {
    if (tripEditId) {
      // Update existing trip - match sheet headers exactly
      const updates = { Fuel_Id: resolvedFuelId, Date: date, StartKM: startKM, EndKM: endKM, Distance: distance, Notes: notes, Mileage: tripMileage, Category: category, vehicle_id: currentVehicleId };
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
        Notes: notes,
        Mileage: tripMileage,
        Category: category,
        vehicle_id: currentVehicleId
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

function mileageBadge(val) {
  if (val == null) return '—';
  const cls = val >= 12 ? 'badge-green' : val >= 10 ? 'badge-blue' : val >= 8 ? 'badge-amber' : 'badge-red';
  return `<span class="badge ${cls}">${fmtN(val, 2)}</span>`;
}

// Color-coded badge for the Diff column, indicating mileage saved/lost
function diffBadge(diff) {
  const badgeClass = diff <= 0 ? 'badge-green' : diff <= 5 ? 'badge-amber' : diff < 10 ? 'badge-orange' : 'badge-red';
  return `<span class="badge ${badgeClass}">${diff.toLocaleString()}</span>`;
}

function getCategoryBadge(category) {
  const categoryMap = {
    'work': { emoji: '🏢', label: 'Work', color: 'badge-blue' },
    'personal': { emoji: '👤', label: 'Personal', color: 'badge-green' },
    'highway': { emoji: '🛣️', label: 'Highway', color: 'badge-amber' },
    'city': { emoji: '🏙️', label: 'City', color: 'badge-orange' },
    'leisure': { emoji: '🎉', label: 'Leisure', color: 'badge-green' },
    'emergency': { emoji: '🚨', label: 'Emergency', color: 'badge-red' }
  };

  if (!category) return '—';
  const cat = categoryMap[category] || { emoji: '📍', label: category, color: 'badge-blue' };
  return `<span class="badge ${cat.color}">${cat.emoji} ${cat.label}</span>`;
}

// Render Trips Table (uses cached trips data from memory)
function renderTrips() {
  const tbody = document.getElementById('tripTableBody');

  if (trips.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px; color: var(--text-muted);">No trips recorded yet. Add one to get started.</td></tr>';
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
    const category = trip.Category || trip.category || '';
    const notes = trip.Notes || trip.notes || '';
    const tripMil = trip.Mileage ?? null;

    return `
    <tr>
      <td data-label="Date">${tripDate ? new Date(tripDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
      <td class="num" data-label="Start KM">${startKM.toLocaleString()}</td>
      <td class="num" data-label="End KM">${endKM.toLocaleString()}</td>
      <td class="num" data-label="Distance"><strong>${distance}</strong> km</td>
      <td class="num" data-label="To Go KM">${toGoKM !== null ? toGoKM.toLocaleString() + ' km' : '—'}</td>
      <td class="num" data-label="Diff">${diff !== null ? diffBadge(diff) : '—'}</td>
      <td class="num" data-label="Mileage">${mileageBadge(tripMil)}</td>
      <td data-label="Category">${getCategoryBadge(category)}</td>
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
  if (currentView === 'analytics') {
    openAdd();
  } else if (currentView === 'trips') {
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

function handleAddClick() {
  if (currentView === 'analytics') {
    openAdd();
  } else if (currentView === 'trips') {
    openAddTrip();
  } else {
    openAdd();
  }
}

function toggleAnalyticsView() {
  if (currentView === 'analytics') {
    switchToHome();
  } else {
    switchToAnalytics();
  }
}

function switchToAnalytics() {
  currentView = 'analytics';
  document.getElementById('mainContent').style.display = 'none';
  document.getElementById('tripContent').style.display = 'none';
  document.getElementById('analyticsContent').style.display = 'block';
  document.getElementById('analyticsToggleBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back';
  document.getElementById('addEntryBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>Add Entry';
  initializeAnalytics();
}

function switchToHome() {
  currentView = 'home';
  document.getElementById('mainContent').style.display = 'block';
  document.getElementById('tripContent').style.display = 'none';
  document.getElementById('analyticsContent').style.display = 'none';
  document.getElementById('analyticsToggleBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 3v18a2 2 0 002 2h16V3"/><path d="M7 12h4M15 8h4M11 16h8M3 8h2M3 12h2M3 16h2"/></svg>Analytics';
  document.getElementById('tripsToggleBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 3H5a2 2 0 00-2 2v4m0 0H3m2 0v16a2 2 0 002 2h12a2 2 0 002-2v-6m0 0h2m-2 0v-4m0 0V5a2 2 0 00-2-2h-4m0 16H9m3-13v6m3-6v6"/></svg>Trip Data';
  document.getElementById('addEntryBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>Add Entry';
}

/* ===================== ANALYTICS ===================== */

let currentAnalyticsMonth = new Date();
let analyticsCharts = {};

function initializeAnalytics() {
  populateMonthSelector();
  updateAnalytics();
}

function populateMonthSelector() {
  const selector = document.getElementById('monthSelector');
  selector.innerHTML = '';

  for (let i = 11; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const value = date.toISOString().slice(0, 7);
    const label = date.toLocaleDateString('en-IN', { year: 'numeric', month: 'long' });

    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (i === 0) option.selected = true;
    selector.appendChild(option);
  }
}

function prevMonth() {
  currentAnalyticsMonth.setMonth(currentAnalyticsMonth.getMonth() - 1);
  const value = currentAnalyticsMonth.toISOString().slice(0, 7);
  document.getElementById('monthSelector').value = value;
  updateAnalytics();
}

function nextMonth() {
  currentAnalyticsMonth.setMonth(currentAnalyticsMonth.getMonth() + 1);
  const value = currentAnalyticsMonth.toISOString().slice(0, 7);
  document.getElementById('monthSelector').value = value;
  updateAnalytics();
}

function updateAnalytics() {
  const selectedMonth = document.getElementById('monthSelector').value;
  const [year, month] = selectedMonth.split('-');
  currentAnalyticsMonth = new Date(year, parseInt(month) - 1);

  const monthData = getMonthlyData(selectedMonth);
  updateAnalyticsCards(monthData);
  updateCharts();
}

function getMonthlyData(monthStr) {
  const [year, month] = monthStr.split('-');
  const monthEntries = data.filter(entry => {
    if (!entry.date) return false;
    const entryDate = entry.date.split('T')[0];
    return entryDate.startsWith(monthStr);
  });

  const totalAmount = monthEntries.reduce((sum, e) => sum + (e.fuelAmount || 0), 0);
  const totalFuel = monthEntries.reduce((sum, e) => sum + (e.fuelQty || 0), 0);
  const monthlyTotalKM = monthEntries.reduce((sum, e) => sum + (totalKM(e) || 0), 0);

  let totalEffectiveKM = 0;
  monthEntries.forEach(e => {
    const eff = effectiveKM(e);
    if (eff != null) totalEffectiveKM += eff;
  });

  const avgMileage = totalFuel > 0 ? totalEffectiveKM / totalFuel : null;
  const costPerKM = monthlyTotalKM > 0 ? totalAmount / monthlyTotalKM : null;
  const avgFuelRate = totalFuel > 0 ? totalAmount / totalFuel : null;

  return { totalAmount, totalFuel, totalKM: monthlyTotalKM, avgMileage, costPerKM, avgFuelRate, entryCount: monthEntries.length };
}

function updateAnalyticsCards(monthData) {
  document.getElementById('monthlySpend').textContent = fmtMon(monthData.totalAmount);
  document.getElementById('monthlyFuel').textContent = fmtN(monthData.totalFuel, 1) + ' L';
  document.getElementById('monthlyKM').textContent = fmtI(monthData.totalKM) + ' km';
  document.getElementById('monthlyMileage').textContent = monthData.avgMileage ? fmtN(monthData.avgMileage, 2) + ' km/L' : '—';
  document.getElementById('costPerKM').textContent = monthData.costPerKM ? '₹' + fmtN(monthData.costPerKM, 2) : '—';
  document.getElementById('avgFuelRate').textContent = monthData.avgFuelRate ? '₹' + fmtN(monthData.avgFuelRate, 2) : '—';
}

function getLast12MonthsData() {
  const months = [];
  const spending = [];
  const mileages = [];
  const costPerKMs = [];

  for (let i = 11; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const monthStr = date.toISOString().slice(0, 7);
    const monthData = getMonthlyData(monthStr);

    months.push(date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }));
    spending.push(monthData.totalAmount);
    mileages.push(monthData.avgMileage || 0);
    costPerKMs.push(monthData.costPerKM || 0);
  }

  return { months, spending, mileages, costPerKMs };
}

function updateCharts() {
  const data12m = getLast12MonthsData();

  updateSpendingChart(data12m);
  updateMileageChart(data12m);
  updateCostPerKMChart(data12m);
}

function updateSpendingChart(data) {
  const ctx = document.getElementById('spendingChart').getContext('2d');

  if (analyticsCharts.spending) {
    analyticsCharts.spending.destroy();
  }

  analyticsCharts.spending = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.months,
      datasets: [{
        label: 'Monthly Spending (₹)',
        data: data.spending,
        backgroundColor: '#2563eb',
        borderColor: '#1d4ed8',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: true, position: 'top' } },
      scales: { y: { beginAtZero: true, title: { display: true, text: 'Amount (₹)' } } }
    }
  });
}

function updateMileageChart(data) {
  const ctx = document.getElementById('mileageChart').getContext('2d');

  if (analyticsCharts.mileage) {
    analyticsCharts.mileage.destroy();
  }

  analyticsCharts.mileage = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.months,
      datasets: [{
        label: 'Average Mileage (km/L)',
        data: data.mileages,
        borderColor: '#16a34a',
        backgroundColor: 'rgba(22, 163, 74, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#16a34a',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: true, position: 'top' } },
      scales: { y: { beginAtZero: true, title: { display: true, text: 'Mileage (km/L)' } } }
    }
  });
}

function updateCostPerKMChart(data) {
  const ctx = document.getElementById('costPerKMChart').getContext('2d');

  if (analyticsCharts.costPerKM) {
    analyticsCharts.costPerKM.destroy();
  }

  analyticsCharts.costPerKM = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.months,
      datasets: [{
        label: 'Cost per KM (₹)',
        data: data.costPerKMs,
        borderColor: '#d97706',
        backgroundColor: 'rgba(217, 119, 6, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#d97706',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: true, position: 'top' } },
      scales: { y: { beginAtZero: true, title: { display: true, text: 'Cost per KM (₹)' } } }
    }
  });
}

/* ===================== FUEL EFFICIENCY ALERTS ===================== */

function checkAndDisplayAlerts() {
  const alerts = [];

  if (data.length < 2) {
    document.getElementById('alertsContainer').style.display = 'none';
    return;
  }

  const avgMil = overallAvgMileage();
  const latestEntry = data.slice().sort((a, b) => (b.endKM ?? 0) - (a.endKM ?? 0))[0];

  // Alert 1: Mileage Drop - If latest entry mileage is significantly below average
  if (latestEntry && avgMil) {
    const latestMil = mileage(latestEntry);
    if (latestMil && latestMil < avgMil * 0.85) {
      const dropPercent = Math.round((1 - latestMil / avgMil) * 100);
      alerts.push({
        type: 'danger',
        icon: '⚙️',
        title: 'Mileage Performance Drop',
        desc: `Latest entry shows ${dropPercent}% below average (${fmtN(latestMil, 2)} vs ${fmtN(avgMil, 2)} km/L). Check vehicle maintenance.`
      });
    }
  }

  // Alert 2: Fuel Price Increase - Compare latest 2 entries
  if (data.length >= 2) {
    const sorted = data.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const latest = sorted[0];
    const prev = sorted.slice(1, 5).find(e => e.fuelRate);

    if (latest && prev && latest.fuelRate && prev.fuelRate) {
      const priceIncrease = latest.fuelRate - prev.fuelRate;
      if (priceIncrease > 2) {
        alerts.push({
          type: 'warning',
          icon: '⛽',
          title: 'Fuel Price Increased',
          desc: `Price jumped by ₹${priceIncrease.toFixed(2)}/L (from ₹${fmtN(prev.fuelRate, 2)} to ₹${fmtN(latest.fuelRate, 2)}). Consider cheaper stations.`
        });
      }
    }
  }

  // Alert 3: Low Fuel Range - If projected range is low
  if (latestEntry && latestEntry.projected && latestEntry.projected < 100) {
    alerts.push({
      type: 'warning',
      icon: '🔋',
      title: 'Low Fuel Range',
      desc: `Projected range is only ${latestEntry.projected} km. Consider refueling soon.`
    });
  }

  // Alert 4: Long Time Since Fill - If more than 7 days since last fill
  if (latestEntry) {
    const lastFillDate = new Date(latestEntry.date);
    const now = new Date();
    const daysSinceFill = Math.floor((now - lastFillDate) / (1000 * 60 * 60 * 24));

    if (daysSinceFill > 7) {
      alerts.push({
        type: 'info',
        icon: '📅',
        title: 'Long Time Since Last Fill',
        desc: `Last fill was ${daysSinceFill} days ago. Haven't been tracking trips?`
      });
    }
  }

  // Display alerts
  const container = document.getElementById('alertsContainer');
  let alertHTML = alerts.map(a => `
    <div class="alert alert-${a.type}">
      <div class="alert-icon">${a.icon}</div>
      <div class="alert-content">
        <div class="alert-title">${a.title}</div>
        <div class="alert-desc">${a.desc}</div>
      </div>
    </div>
  `).join('');

  if (alerts.length > 0 || data.length >= 3) {
    container.innerHTML = alertHTML;
    container.style.display = 'block';
    displayPredictiveInsights();
  } else {
    container.style.display = 'none';
  }
}

/* ===================== PREDICTIVE FEATURES ===================== */

function getPredictiveInsights() {
  if (data.length < 3) return null;

  const sorted = data.slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  // Calculate average days between fills
  const dates = sorted.map(e => new Date(e.date)).filter((d, i) => i < 10);
  let totalDays = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    totalDays += (dates[i] - dates[i + 1]) / (1000 * 60 * 60 * 24);
  }
  const avgDaysBetweenFills = dates.length > 1 ? totalDays / (dates.length - 1) : 0;

  // Predict next fill date
  const lastFillDate = new Date(sorted[0].date);
  const nextFillDate = new Date(lastFillDate.getTime() + avgDaysBetweenFills * 24 * 60 * 60 * 1000);
  const daysUntilNextFill = Math.round((nextFillDate - new Date()) / (1000 * 60 * 60 * 24));

  // Average monthly spending
  const now = new Date();
  const thisMonthEntries = data.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisMonthSpend = thisMonthEntries.reduce((sum, e) => sum + (e.fuelAmount || 0), 0);
  const avgMonthlySpend = data.reduce((sum, e) => sum + (e.fuelAmount || 0), 0) / Math.max(1, Math.ceil(data.length / (avgDaysBetweenFills > 0 ? avgDaysBetweenFills / 30 : 1)));

  // Fuel price trend
  const lastPrice = sorted[0].fuelRate || 0;
  const prevPrice = sorted.slice(1, 6).find(e => e.fuelRate)?.fuelRate || lastPrice;
  const priceChange = lastPrice - prevPrice;

  // Range accuracy
  const rangeAccuracyData = sorted.slice(0, 10).map(e => ({
    projected: e.projected || 0,
    actual: effectiveKM(e) || 0
  })).filter(r => r.projected > 0 && r.actual > 0);

  const avgProjected = rangeAccuracyData.length > 0 ? rangeAccuracyData.reduce((s, r) => s + r.projected, 0) / rangeAccuracyData.length : 0;
  const avgActual = rangeAccuracyData.length > 0 ? rangeAccuracyData.reduce((s, r) => s + r.actual, 0) / rangeAccuracyData.length : 0;
  const rangeAccuracy = avgProjected > 0 ? (avgActual / avgProjected * 100) : 100;

  return {
    nextFillDate,
    daysUntilNextFill,
    avgDaysBetweenFills,
    thisMonthSpend,
    avgMonthlySpend,
    priceChange,
    lastPrice,
    rangeAccuracy
  };
}

function displayPredictiveInsights() {
  const insights = getPredictiveInsights();
  if (!insights) return;

  const container = document.getElementById('alertsContainer');
  const nextFillHTML = insights.daysUntilNextFill > 0
    ? `Expected next fill in ~${insights.daysUntilNextFill} days`
    : `Next fill date may be soon!`;

  const budgetHTML = insights.avgMonthlySpend > 0
    ? `Average: ₹${fmtN(insights.avgMonthlySpend, 0)}/month`
    : 'Not enough data';

  const priceHTML = insights.priceChange > 0
    ? `Price up by ₹${insights.priceChange.toFixed(2)}/L`
    : insights.priceChange < 0
    ? `Price down by ₹${Math.abs(insights.priceChange).toFixed(2)}/L`
    : 'Price stable';

  const rangeHTML = insights.rangeAccuracy >= 95
    ? `Very Accurate (${Math.round(insights.rangeAccuracy)}%)`
    : insights.rangeAccuracy >= 85
    ? `Good Accuracy (${Math.round(insights.rangeAccuracy)}%)`
    : `Fair Accuracy (${Math.round(insights.rangeAccuracy)}%)`;

  const predictiveHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
      <div style="background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; border-left: 4px solid #3b82f6;">
        <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">📅 Next Fill</div>
        <div style="font-weight: 700; color: var(--text);">${nextFillHTML}</div>
      </div>
      <div style="background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; border-left: 4px solid #10b981;">
        <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">💰 Budget</div>
        <div style="font-weight: 700; color: var(--text);">${budgetHTML}</div>
      </div>
      <div style="background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; border-left: 4px solid #f59e0b;">
        <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">⛽ Price Trend</div>
        <div style="font-weight: 700; color: var(--text);">${priceHTML}</div>
      </div>
      <div style="background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; border-left: 4px solid #8b5cf6;">
        <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">🎯 Range Accuracy</div>
        <div style="font-weight: 700; color: var(--text);">${rangeHTML}</div>
      </div>
    </div>
  `;

  const alertsHTML = container.innerHTML;
  container.innerHTML = predictiveHTML + (alertsHTML ? '<div style="margin-top: 12px;">' + alertsHTML + '</div>' : '');
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
  initializeVehicles();
  initializeData();
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
  initializeDarkMode();
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
