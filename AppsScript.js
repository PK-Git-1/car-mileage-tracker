// Google Apps Script - Deploy as Web App
// This file handles all CRUD operations for fuel log in Google Sheets
// Deploy Instructions:
// 1. Go to https://script.google.com
// 2. Create new project
// 3. Copy this code into "Code.gs"
// 4. Save the project
// 5. Deploy → New deployment → Web app
// 6. Execute as: Me
// 7. Allow access: Anyone
// 8. Copy the deployment URL and use it in frontend app.js

const SHEET_ID = '1f6JYIwbuMC3dmIw--NzhRWJTFD-yqYrxkh8sQpYxUdk';
const FUEL_SHEET_NAME = 'Sheet1';
const TRIPS_SHEET_NAME = 'Trips';

// Get spreadsheet
const ss = SpreadsheetApp.openById(SHEET_ID);

// Helper to get sheet by name or create it
function getOrCreateSheet(sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    // Add headers based on sheet type
    if (sheetName === TRIPS_SHEET_NAME) {
      sheet.appendRow(['id', 'Date', 'StartKM', 'EndKM', 'Distance', 'Notes']);
    }
  }
  return sheet;
}

// ============ UTILITY FUNCTIONS ============

function getHeaders(sheet) {
  const range = sheet.getRange(1, 1, 1, sheet.getLastColumn());
  return range.getValues()[0];
}

function getAllData(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return []; // Only header, no data

  const range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
  const values = range.getValues();
  const headers = getHeaders(sheet);

  const data = [];
  for (const row of values) {
    if (!row[0]) continue; // Skip empty rows
    const entry = {};
    for (let i = 0; i < headers.length; i++) {
      entry[headers[i]] = row[i];
    }
    data.push(entry);
  }
  return data;
}

function convertToRow(entry, headers) {
  const row = [];
  for (const header of headers) {
    row.push(entry[header] ?? '');
  }
  return row;
}

// ============ CRUD OPERATIONS ============

// CREATE - Add new entry
function addEntry(entry, sheetName = FUEL_SHEET_NAME) {
  try {
    const sheet = getOrCreateSheet(sheetName);
    const headers = getHeaders(sheet);
    entry.id = entry.id || Utilities.getUuid();
    const row = convertToRow(entry, headers);
    sheet.appendRow(row);
    return { success: true, entry };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// READ - Get all entries
function getAllEntries(sheetName = FUEL_SHEET_NAME) {
  try {
    const sheet = getOrCreateSheet(sheetName);
    const data = getAllData(sheet);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// READ - Get single entry by ID
function getEntry(id, sheetName = FUEL_SHEET_NAME) {
  try {
    const sheet = getOrCreateSheet(sheetName);
    const data = getAllData(sheet);
    const entry = data.find(e => e.id === id);
    if (!entry) {
      return { success: false, error: 'Entry not found' };
    }
    return { success: true, entry };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// UPDATE - Update entry by ID
function updateEntry(id, updates, sheetName = FUEL_SHEET_NAME) {
  try {
    const sheet = getOrCreateSheet(sheetName);
    const lastRow = sheet.getLastRow();
    const headers = getHeaders(sheet);

    for (let i = 2; i <= lastRow; i++) {
      const row = sheet.getRange(i, 1, 1, headers.length).getValues()[0];
      if (row[0] === id) {
        // Found the entry
        const entry = {};
        for (let j = 0; j < headers.length; j++) {
          entry[headers[j]] = row[j];
        }
        // Merge updates
        Object.assign(entry, updates);
        const newRow = convertToRow(entry, headers);
        sheet.getRange(i, 1, 1, headers.length).setValues([newRow]);
        return { success: true, entry };
      }
    }
    return { success: false, error: 'Entry not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// DELETE - Delete entry by ID
function deleteEntry(id, sheetName = FUEL_SHEET_NAME) {
  try {
    const sheet = getOrCreateSheet(sheetName);
    const lastRow = sheet.getLastRow();
    const headers = getHeaders(sheet);

    for (let i = 2; i <= lastRow; i++) {
      const row = sheet.getRange(i, 1, 1, headers.length).getValues()[0];
      if (row[0] === id) {
        sheet.deleteRow(i);
        return { success: true, message: 'Entry deleted' };
      }
    }
    return { success: false, error: 'Entry not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// SAVE ALL DATA - Replace all entries (bulk operation)
function saveAllData(dataArray, sheetName = FUEL_SHEET_NAME) {
  try {
    const sheet = getOrCreateSheet(sheetName);
    // Clear existing data (keep header)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }

    // Add new rows
    if (dataArray.length > 0) {
      const headers = getHeaders(sheet);
      for (const entry of dataArray) {
        const row = convertToRow(entry, headers);
        sheet.appendRow(row);
      }
    }

    return { success: true, message: 'Data saved', count: dataArray.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============ WEB APP DEPLOYMENT ============

function doGet(e) {
  const action = e.parameter.action;
  const id = e.parameter.id;
  const sheetName = e.parameter.sheet || FUEL_SHEET_NAME;

  try {
    switch (action) {
      case 'get':
        return sendResponse(getAllEntries(sheetName));
      case 'getOne':
        return sendResponse(getEntry(id, sheetName));
      case 'status':
        return sendResponse({
          success: true,
          connected: true,
          spreadsheetId: SHEET_ID,
          fuelSheet: FUEL_SHEET_NAME,
          tripsSheet: TRIPS_SHEET_NAME,
          message: 'Google Apps Script API connected'
        });
      default:
        return sendResponse({
          success: true,
          data: getAllData(getOrCreateSheet(sheetName))
        });
    }
  } catch (err) {
    return sendResponse({ success: false, error: err.message });
  }
}

function doPost(e) {
  const action = e.parameter.action;
  const sheetName = e.parameter.sheet || FUEL_SHEET_NAME;
  const payload = JSON.parse(e.postData.contents);

  try {
    switch (action) {
      case 'add':
        return sendResponse(addEntry(payload.entry, sheetName));
      case 'update':
        return sendResponse(updateEntry(payload.id, payload.updates, sheetName));
      case 'delete':
        return sendResponse(deleteEntry(payload.id, sheetName));
      case 'saveAll':
        return sendResponse(saveAllData(payload.data, sheetName));
      default:
        return sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    return sendResponse({ success: false, error: err.message });
  }
}

function sendResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
