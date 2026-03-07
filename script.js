/**
 * TOP AIR HVAC — Google Apps Script Backend
 * ==========================================
 * Deploy this as a Web App (Execute as: Me, Access: Anyone)
 * Then paste the deployment URL into the app's Settings > Google Sheets Sync URL
 *
 * Sheet tabs created automatically:
 *   Jobs | Inventory | Investments | ServiceList | MonthlySummary | Settings
 */

const SHEET_NAMES = {
  jobs: 'Jobs',
  inventory: 'Inventory',
  investments: 'Investments',
  serviceList: 'ServiceList',
  summary: 'MonthlySummary',
  settings: 'Settings',
  log: 'SyncLog'
};

// ============================================================
// ENTRY POINTS
// ============================================================

function doGet(e) {
  setupSheets();
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Top Air HVAC Sheets backend is running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const type = payload.type;
    const data = payload.data;

    setupSheets();

    const handlers = {
      jobs:        () => syncJobs(data),
      inventory:   () => syncInventory(data),
      investments: () => syncInvestments(data),
      serviceList: () => syncServiceList(data),
      settings:    () => syncSettings(data),
      all:         () => {
        if (data.jobs)        syncJobs(data.jobs);
        if (data.inventory)   syncInventory(data.inventory);
        if (data.investments) syncInvestments(data.investments);
        if (data.serviceList) syncServiceList(data.serviceList);
        if (data.settings)    syncSettings(data.settings);
      }
    };

    if (handlers[type]) {
      handlers[type]();
      logSync(type, (Array.isArray(data) ? data.length : 1) + ' records');
    }

    // Always rebuild monthly summary after jobs sync
    if (type === 'jobs' || type === 'all') buildMonthlySummary(data.jobs || data);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', type }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    logSync('error', err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// SHEET SETUP
// ============================================================

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const needed = Object.values(SHEET_NAMES);
  needed.forEach(name => {
    if (!ss.getSheetByName(name)) {
      ss.insertSheet(name);
    }
  });
  setupHeaders();
}

function setupHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const headers = {
    [SHEET_NAMES.jobs]: [
      'ID', 'Customer', 'Phone', 'Service', 'Date', 'Amount', 'Materials',
      'Profit', 'Payment', 'Job Type', 'Miles', 'Travel Fee', 'Travel Fee Amt',
      'Timer (secs)', 'Timer (formatted)', 'Notes', 'Has Before Photo', 'Has After Photo'
    ],
    [SHEET_NAMES.inventory]: [
      'ID', 'Name', 'Type / Model', 'Quantity', 'Cost Per Unit', 'Total Value', 'Low Stock Alert'
    ],
    [SHEET_NAMES.investments]: [
      'ID', 'Name', 'Category', 'Estimated Cost', 'Priority', 'Status', 'Source', 'Notes'
    ],
    [SHEET_NAMES.serviceList]: [
      'ID', 'Service Name', 'Device / Type', 'Price', 'Materials Cost', 'Profit', 'Margin %'
    ],
    [SHEET_NAMES.summary]: [
      'Month', 'Year', 'Jobs Count', 'Total Revenue', 'Total Materials', 'Total Profit',
      'Paid Jobs', 'Unpaid Jobs', 'Unpaid Balance', 'Total Miles', 'Travel Fees Collected'
    ],
    [SHEET_NAMES.settings]: [
      'Key', 'Value', 'Last Updated'
    ],
    [SHEET_NAMES.log]: [
      'Timestamp', 'Type', 'Details'
    ]
  };

  Object.entries(headers).forEach(([sheetName, cols]) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const firstRow = sheet.getRange(1, 1, 1, cols.length).getValues()[0];
    // Only write headers if first cell is empty
    if (!firstRow[0]) {
      sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
      sheet.getRange(1, 1, 1, cols.length)
        .setBackground('#1565C0')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold')
        .setFontSize(11);
      sheet.setFrozenRows(1);
    }
  });
}

// ============================================================
// SYNC JOBS
// ============================================================

function syncJobs(jobs) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.jobs);
  if (!sheet || !Array.isArray(jobs)) return;

  // Clear existing data rows
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  if (jobs.length === 0) return;

  const rows = jobs.map(j => {
    const amount  = parseFloat(j.amount)    || 0;
    const mat     = parseFloat(j.materials) || 0;
    const profit  = amount - mat;
    const tFeeAmt = j.travelFee ? (parseFloat(j.travelFeeAmt) || 0) : 0;
    const timer   = parseInt(j.timerSecs)   || 0;
    const timerFmt = timer > 0 ? formatSecs(timer) : '';

    return [
      j.id || '',
      j.customer || '',
      j.phone || '',
      j.service || '',
      j.date || '',
      amount,
      mat,
      profit,
      j.payment || 'unpaid',
      j.mobileType || 'onsite',
      parseFloat(j.miles) || 0,
      j.travelFee ? 'Yes' : 'No',
      tFeeAmt,
      timer,
      timerFmt,
      j.notes || '',
      j.beforePhoto ? 'Yes' : 'No',
      j.afterPhoto  ? 'Yes' : 'No'
    ];
  });

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);

  // Format currency columns
  const currCols = [6, 7, 8, 13]; // Amount, Materials, Profit, Travel Fee Amt
  currCols.forEach(col => {
    sheet.getRange(2, col, rows.length, 1).setNumberFormat('$#,##0.00');
  });

  // Color paid/unpaid
  rows.forEach((row, i) => {
    const cell = sheet.getRange(i + 2, 9); // Payment column
    if (row[8] === 'paid') {
      cell.setBackground('#E6F5EE').setFontColor('#1B8B5A').setFontWeight('bold');
    } else {
      cell.setBackground('#FDEDEC').setFontColor('#C0392B').setFontWeight('bold');
    }
  });

  autoResizeColumns(sheet);
}

// ============================================================
// SYNC INVENTORY
// ============================================================

function syncInventory(items) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.inventory);
  if (!sheet || !Array.isArray(items)) return;

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  if (items.length === 0) return;

  const rows = items.map(i => {
    const qty   = parseInt(i.qty)   || 0;
    const cost  = parseFloat(i.cost) || 0;
    const total = qty * cost;
    return [
      i.id || '',
      i.name || '',
      i.type || '',
      qty,
      cost,
      total,
      i.alert || ''
    ];
  });

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(2, 5, rows.length, 2).setNumberFormat('$#,##0.00');

  // Highlight low stock
  rows.forEach((row, i) => {
    const qty   = row[3];
    const alert = parseInt(row[6]) || 0;
    if (alert && qty <= alert) {
      sheet.getRange(i + 2, 1, 1, rows[0].length).setBackground('#FEF3E7');
    }
  });

  autoResizeColumns(sheet);
}

// ============================================================
// SYNC INVESTMENTS
// ============================================================

function syncInvestments(items) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.investments);
  if (!sheet || !Array.isArray(items)) return;

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  if (items.length === 0) return;

  const rows = items.map(i => [
    i.id || '',
    i.name || '',
    i.category || '',
    parseFloat(i.cost) || 0,
    i.priority || '',
    i.status || '',
    i.source || '',
    i.notes || ''
  ]);

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(2, 4, rows.length, 1).setNumberFormat('$#,##0.00');

  // Color by status
  rows.forEach((row, i) => {
    const statusCell = sheet.getRange(i + 2, 6);
    if (row[5] === 'purchased') {
      statusCell.setBackground('#E6F5EE').setFontColor('#1B8B5A').setFontWeight('bold');
    } else {
      statusCell.setBackground('#E3F2FD').setFontColor('#1565C0').setFontWeight('bold');
    }
    // Color by priority
    const priCell = sheet.getRange(i + 2, 5);
    const priColors = { high: ['#FDEDEC','#C0392B'], medium: ['#FEF3E7','#B7621B'], low: ['#E6F5EE','#1B8B5A'] };
    const pc = priColors[row[4]] || ['',''];
    if (pc[0]) priCell.setBackground(pc[0]).setFontColor(pc[1]).setFontWeight('bold');
  });

  autoResizeColumns(sheet);
}

// ============================================================
// SYNC SERVICE LIST
// ============================================================

function syncServiceList(items) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.serviceList);
  if (!sheet || !Array.isArray(items)) return;

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  if (items.length === 0) return;

  const rows = items.map(s => {
    const price  = parseFloat(s.price)     || 0;
    const mat    = parseFloat(s.materials) || 0;
    const profit = price - mat;
    const margin = price > 0 ? ((profit / price) * 100).toFixed(1) : '0.0';
    return [
      s.id || '',
      s.name || '',
      s.device || '',
      price,
      mat,
      profit,
      parseFloat(margin)
    ];
  });

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(2, 4, rows.length, 3).setNumberFormat('$#,##0.00');
  sheet.getRange(2, 7, rows.length, 1).setNumberFormat('0.0"%"');

  autoResizeColumns(sheet);
}

// ============================================================
// SYNC SETTINGS
// ============================================================

function syncSettings(s) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.settings);
  if (!sheet || !s) return;

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  const now = new Date().toISOString();
  // Do not sync sensitive fields
  const safe = { ...s };
  delete safe.password;

  const rows = Object.entries(safe).map(([k, v]) => [k, String(v), now]);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  autoResizeColumns(sheet);
}

// ============================================================
// MONTHLY SUMMARY
// ============================================================

function buildMonthlySummary(jobs) {
  if (!Array.isArray(jobs)) return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.summary);
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  // Aggregate by month
  const map = {};
  jobs.forEach(j => {
    const mk = (j.date || '').slice(0, 7);
    if (!mk) return;
    if (!map[mk]) map[mk] = { count: 0, rev: 0, mat: 0, paid: 0, unpaid: 0, unpaidBal: 0, miles: 0, travel: 0 };
    const m = map[mk];
    m.count++;
    m.rev  += parseFloat(j.amount)    || 0;
    m.mat  += parseFloat(j.materials) || 0;
    if (j.payment === 'paid') m.paid++;
    else { m.unpaid++; m.unpaidBal += parseFloat(j.amount) || 0; }
    m.miles  += parseFloat(j.miles) || 0;
    m.travel += j.travelFee ? parseFloat(j.travelFeeAmt) || 0 : 0;
  });

  const sortedKeys = Object.keys(map).sort();
  if (sortedKeys.length === 0) return;

  const rows = sortedKeys.map(mk => {
    const [yr, mo] = mk.split('-');
    const d = map[mk];
    return [
      mk,
      parseInt(yr),
      d.count,
      d.rev,
      d.mat,
      d.rev - d.mat,
      d.paid,
      d.unpaid,
      d.unpaidBal,
      d.miles,
      d.travel
    ];
  });

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);

  // Format currency columns: Revenue, Materials, Profit, UnpaidBal, Travel
  [4, 5, 6, 9, 11].forEach(col => {
    sheet.getRange(2, col, rows.length, 1).setNumberFormat('$#,##0.00');
  });

  // Alternate row colors
  rows.forEach((_, i) => {
    if (i % 2 === 0) {
      sheet.getRange(i + 2, 1, 1, rows[0].length).setBackground('#F0F7FF');
    }
  });

  autoResizeColumns(sheet);
}

// ============================================================
// SYNC LOG
// ============================================================

function logSync(type, details) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.log);
    if (!sheet) return;
    sheet.appendRow([new Date().toISOString(), type, details]);
    // Keep only last 100 log entries
    const lastRow = sheet.getLastRow();
    if (lastRow > 101) sheet.deleteRows(2, lastRow - 101);
  } catch (e) {
    // Silently fail
  }
}

// ============================================================
// UTILITIES
// ============================================================

function formatSecs(secs) {
  const h  = Math.floor(secs / 3600);
  const m  = Math.floor((secs % 3600) / 60);
  const s  = secs % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function autoResizeColumns(sheet) {
  try {
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) sheet.autoResizeColumns(1, lastCol);
  } catch (e) {
    // Ignore
  }
}

// ============================================================
// MANUAL TRIGGER — run from Apps Script editor to set up
// ============================================================

function setup() {
  setupSheets();
  Logger.log('Top Air HVAC sheets configured successfully.');
}
