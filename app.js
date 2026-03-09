const API_URL =
'https://script.google.com/macros/s/AKfycbx0lhTUU2rzmk0oyXhVY2lFG56E6zRuXK9OgT1QKkWAtzLErg9Arl8S6corI6gxB1qO7A/exec';

let entries = [];

/* ============================== LOGIN ================================
*/

function submitLogin() {

const u = document.getElementById('loginUsername').value; const p =
document.getElementById('loginPassword').value;

if (u === 'admin' && p === '1234') {
document.getElementById('loginScreen').classList.add('hidden');
document.getElementById('mainContent').style.display = 'block';
loadDataFromAPI(); } else { showToast('Invalid login', 'error'); }

}

function logout() { location.reload(); }

/* ============================== LOAD DATA
================================ */

async function loadDataFromAPI() {

try {

    console.log('📡 Fetching data from Google Sheets...');

    const res = await fetch(API_URL + '?action=get');
    const data = await res.json();

    entries = data;

    renderTable();
    updateSummary();

    console.log('Loaded', entries.length, 'entries');

} catch (err) {

    console.error(err);
    showToast('Failed loading data', 'error');

}

}

/* ============================== SAVE ENTRY
================================ */

async function saveEntry(e) {

if (e) e.preventDefault();

const entry = {

    bunk: document.getElementById('f_bunk').value,
    date: document.getElementById('f_date').value,
    startKM: document.getElementById('f_startKM').value,
    endKM: document.getElementById('f_endKM').value,
    fuelAmount: document.getElementById('f_amount').value,
    fuelRate: document.getElementById('f_rate').value,
    fuelQty: document.getElementById('f_qty').value

};

try {

    const url =
      API_URL +
      '?action=add' +
      '&bunk=' + encodeURIComponent(entry.bunk) +
      '&date=' + entry.date +
      '&startKM=' + entry.startKM +
      '&endKM=' + entry.endKM +
      '&fuelAmount=' + entry.fuelAmount +
      '&fuelRate=' + entry.fuelRate +
      '&fuelQty=' + entry.fuelQty;

    await fetch(url);

    showToast('Entry saved', 'success');

    closeModal();

    loadDataFromAPI();

} catch (err) {

    console.error(err);
    showToast('Error saving entry', 'error');

}

}

/* ============================== TABLE RENDER
================================ */

function renderTable() {

const tbody = document.getElementById('tableBody');

if (!entries.length) {

    tbody.innerHTML =
      `<tr><td colspan='13' class='empty-state'>
      <p>No entries yet</p>
      </td></tr>`;

    return;

}

tbody.innerHTML = entries.map(e => {

    const totalKM = (e.endKM || 0) - (e.startKM || 0);
    const mileage = totalKM && e.fuelQty ? totalKM / e.fuelQty : 0;

    return `

${e.bunk || ''}</td>
<td>${e.date || ''}
${e.startKM || ''}</td>
<td>${e.endKM || ''}
totalKM < /td >  < td>{e.fuelAmount || ''}
${e.fuelRate || ''}</td>
<td>${e.fuelQty || ''}
${mileage ? mileage.toFixed(2) : '-'}

`;

}).join('');

}

/* ============================== SUMMARY
================================ */

function updateSummary() {

document.getElementById('sumEntries').innerText = entries.length;

let totalAmount = 0; let totalLitres = 0; let totalKM = 0;

entries.forEach(e => {

    totalAmount += Number(e.fuelAmount || 0);
    totalLitres += Number(e.fuelQty || 0);

    if (e.startKM && e.endKM)
      totalKM += (e.endKM - e.startKM);

});

document.getElementById('sumAmount').innerHTML = '₹' +
totalAmount.toFixed(0); document.getElementById('sumLitres').innerText =
totalLitres.toFixed(2) + ' L';
document.getElementById('sumKM').innerText = totalKM;

if (totalLitres > 0) {

    const mileage = totalKM / totalLitres;

    document.getElementById('sumMileage').innerText =
      mileage.toFixed(2) + ' km/L';

}

}

/* ============================== CALCULATIONS
================================ */

function calcAll() {

const amount = Number(document.getElementById('f_amount').value); const
rate = Number(document.getElementById('f_rate').value);

if (amount && rate) {

    const qty = amount / rate;

    document.getElementById('qtyDisplay').innerText =
      qty.toFixed(2) + ' L';

    document.getElementById('f_qty').value = qty;

}

const start = Number(document.getElementById('f_startKM').value); const
end = Number(document.getElementById('f_endKM').value);

if (start && end) {

    const total = end - start;

    document.getElementById('totalKMDisplay').innerText =
      total + ' km';

}

}

/* ============================== MODAL ================================
*/

function openAdd() {

document.getElementById('entryForm').reset();

document.getElementById('formOverlay').classList.add('open');

}

function closeModal() {

document.getElementById('formOverlay').classList.remove('open');

}

function overlayClick(e,id){

if(e.target.id===id)
document.getElementById(id).classList.remove('open');

}

/* ============================== TOAST ================================
*/

function showToast(msg,type='success'){

const t=document.getElementById('toast');

t.innerText=msg;

t.className='toast show'+type;

setTimeout(()=>{ t.classList.remove('show'); },2500);

}
