// ===== GOOGLE APPS SCRIPT BACKEND =====
// Community Portal - Backend API
// Deploy as web app with access to anyone

// ===== CONFIGURATION =====
const SPREADSHEET_ID = '1zvOlSFZGB8A_U3h4Yx6WQtSm-zmXiM7Xh_FFxCewDiY'; // your Google Sheet ID
const SHEET_NAMES = {
  users: 'Users',
  leaders: 'Leaders',
  donations: 'Donations',
  messages: 'Messages'
};

// ===== VALIDATION =====
function validateConfig() {
  // Make sure the ID isn't blank or still the placeholder text
  if (!SPREADSHEET_ID || SPREADSHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') {
    throw new Error('SPREADSHEET_ID not configured. Please set your Google Sheet ID in Code.gs line 6.');
  }
}

// ===== MAIN HANDLER =====
function doPost(e) {
  try {
    // If the request is OPTIONS, we need to handle it for CORS preflight
    if (e.postData === null) {
      // preflight request – just return an empty text output
      return ContentService.createTextOutput('')
        .setMimeType(ContentService.MimeType.TEXT);
    }
    
    const data = JSON.parse(e.postData.contents);
    const endpoint = e.parameter.endpoint;

    const response = handleEndpoint(endpoint, data);
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    success: false,
    error: 'Use POST requests only'
  }))
  .setMimeType(ContentService.MimeType.JSON);
}

// ===== ENDPOINT ROUTER =====
function handleEndpoint(endpoint, data) {
  switch (endpoint) {
    // Auth
    case 'signup':
      return handleSignup(data);
    case 'login':
      return handleLogin(data);

    // Leaders
    case 'leaders/get':
      return handleGetLeaders();
    case 'leaders/create':
      return handleCreateLeader(data);
    case 'leaders/update':
      return handleUpdateLeader(data);
    case 'leaders/delete':
      return handleDeleteLeader(data);

    // Donations
    case 'donations/get':
      return handleGetDonations(data);
    case 'donations/update':
      return handleUpdateDonation(data);

    // Messages
    case 'messages/create':
      return handleCreateMessage(data);
    case 'messages/get':
      return handleGetMessages();

    // Stats
    case 'stats/get':
      return handleGetStats();

    default:
      return { success: false, error: 'Unknown endpoint' };
  }
}

// ===== UTILITY FUNCTIONS =====
function getSheet(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(sheetName);
}

function getSheetData(sheetName) {
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  return data.length > 1 ? data.slice(1) : [];
}

function getSheetHeaders(sheetName) {
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  return data[0] || [];
}

function getColumnIndex(sheetName, columnName) {
  const headers = getSheetHeaders(sheetName) || [];
  // perform case-insensitive match and allow fuzzy matches like "userEmail" vs "email"
  const lower = String(columnName).toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    const headerLower = String(headers[i]).toLowerCase();
    if (headerLower === lower) {
      return i;
    }
    // fallback: if header contains the target name or vice versa
    if (headerLower.includes(lower) || lower.includes(headerLower)) {
      return i;
    }
  }
  return -1;  // Return -1 if not found
}

function findRowByValue(sheetName, columnName, value) {
  const sheet = getSheet(sheetName);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  const colIndex = getColumnIndex(sheetName, columnName);
  if (colIndex === -1) return null;

  for (let i = 1; i < data.length; i++) {
    const cell = data[i][colIndex];
    // compare as strings, case-insensitive
    if (String(cell).toLowerCase() === String(value).toLowerCase()) {
      return { row: i + 1, data: data[i] };
    }
  }
  return null;
}

function generateId() {
  return 'ID_' + Utilities.getUuid();
}

function generateTimestamp() {
  return new Date().toISOString();
}

// ===== NEW HELPERS =====
// Return a human-readable current month (e.g. "March" or "March 2026")
function getCurrentMonth() {
  const now = new Date();
  return now.toLocaleString('default', { month: 'long' });
}

// Ensure donation sheet has the expected header columns, add any missing ones,
// and if the columns are out of order re-arrange the whole sheet to match the
// desired sequence (so row data stays aligned).
function ensureDonationHeaders() {
  const sheet = getSheet(SHEET_NAMES.donations);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) return;

  let headers = data[0].map(h => String(h));
  const lower = headers.map(h => h.toLowerCase());
  const required = ['id', 'email', 'name', 'month', 'status', 'amount'];

  // append any missing required headers
  required.forEach(h => {
    if (lower.indexOf(h) === -1) {
      headers.push(h);
      lower.push(h);
    }
  });

  // determine if the current order matches the required order for existing columns
  let needsReorder = false;
  for (let i = 0; i < required.length; i++) {
    const req = required[i];
    const idx = lower.indexOf(req);
    if (idx !== -1 && idx !== i) {
      needsReorder = true;
      break;
    }
  }

  if (needsReorder) {
    // build new headers array with required first (in fixed order), then any
    // extra headers in their original relative order
    const extras = [];
    headers.forEach((h, i) => {
      const low = h.toLowerCase();
      if (required.indexOf(low) === -1) {
        extras.push(h);
      }
    });
    const newHeaders = required.slice(0); // copy
    // use existing casing from headers when available
    newHeaders.forEach((h, idx) => {
      const origIdx = lower.indexOf(h);
      if (origIdx !== -1) newHeaders[idx] = headers[origIdx];
    });
    newHeaders.push(...extras);

    // reorder all rows accordingly
    const newData = data.map(row => {
      const newRow = [];
      newHeaders.forEach(h => {
        const low = String(h).toLowerCase();
        const oldIdx = lower.indexOf(low);
        newRow.push(oldIdx !== -1 ? row[oldIdx] : '');
      });
      return newRow;
    });
    // write back
    sheet.getRange(1, 1, newData.length, newHeaders.length).setValues(newData);
    headers = newHeaders;
  } else if (headers.length !== data[0].length) {
    // if we only appended headers without reordering, update first row
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

// Ensure at least one donation record exists for the given email.
// If no row is found for that email, append a placeholder entry so
// the user will appear in the admin donations table.
function ensureDonationRecord(email) {
  if (!email) return;
  const sheet = getSheet(SHEET_NAMES.donations);
  if (!sheet) return;

  // make sure headers include 'name' and 'amount' (adds them if missing)
  ensureDonationHeaders();

  const data = sheet.getDataRange().getValues();
  const currentMonth = getCurrentMonth();
  if (data.length <= 1) {
    // no records at all, just add one for the current month
    // attempt to lookup user name from users sheet
    let userName = '';
    const userRow = findRowByValue(SHEET_NAMES.users, 'email', email);
    if (userRow) {
      const nameIdx = getColumnIndex(SHEET_NAMES.users, 'name');
      if (nameIdx !== -1) userName = userRow.data[nameIdx] || '';
    }
    const newRow = [generateId(), email, userName, currentMonth, 'pending', ''];
    sheet.appendRow(newRow);
    return;
  }

  // headers to find email and month column indices
  const headers = data[0].map(h => String(h).toLowerCase());
  let emailIdx = headers.indexOf('email');
  let monthIdx = headers.indexOf('month');
  if (emailIdx === -1) {
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].includes('email')) {
        emailIdx = i;
        break;
      }
    }
  }
  if (monthIdx === -1) {
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].includes('month')) {
        monthIdx = i;
        break;
      }
    }
  }

  if (emailIdx === -1) {
    // cannot locate email column, abort
    return;
  }

  // check if there is already a row for this user and current month
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowEmail = emailIdx !== -1 ? String(row[emailIdx]).toLowerCase() : '';
    const rowMonth = monthIdx !== -1 ? String(row[monthIdx]) : '';

    let emailMatches = rowEmail === String(email).toLowerCase();
    if (!emailMatches) {
      // fallback: scan entire row for the email value (handles misaligned rows)
      for (let j = 0; j < row.length; j++) {
        if (String(row[j]).toLowerCase() === String(email).toLowerCase()) {
          emailMatches = true;
          // also fix the email column if it was empty
          if (emailIdx !== -1 && !rowEmail) {
            sheet.getRange(i + 1, emailIdx + 1).setValue(email);
          }
          break;
        }
      }
    }

    // determine if month matches, with fallback scanning row
    let monthMatches = rowMonth === currentMonth;
    if (!monthMatches) {
      for (let j = 0; j < row.length; j++) {
        if (String(row[j]).toLowerCase() === String(currentMonth).toLowerCase()) {
          monthMatches = true;
          // optionally fix month column if empty
          if (monthIdx !== -1 && (!row[monthIdx] || String(row[monthIdx]).trim() === '')) {
            sheet.getRange(i + 1, monthIdx + 1).setValue(currentMonth);
          }
          break;
        }
      }
    }

    if (emailMatches && monthMatches) {
      return; // record for this month already exists
    }
  }

  // no matching entry for the current month, add placeholder
  // lookup user name from users sheet
  let userName = '';
  const userRow = findRowByValue(SHEET_NAMES.users, 'email', email);
  if (userRow) {
    const nameIdx = getColumnIndex(SHEET_NAMES.users, 'name');
    if (nameIdx !== -1) userName = userRow.data[nameIdx] || '';
  }

  // build new row according to current headers so values stay aligned
  const donationHeaders = getSheetHeaders(SHEET_NAMES.donations).map(h => String(h).toLowerCase());
  const row = new Array(donationHeaders.length).fill('');
  const setCell = (colName, value) => {
    const idx = donationHeaders.indexOf(colName);
    if (idx !== -1) row[idx] = value;
  };
  setCell('id', generateId());
  setCell('email', email);
  setCell('name', userName);
  setCell('month', currentMonth);
  setCell('status', 'pending');
  setCell('amount', '');

  sheet.appendRow(row);

}

// SHA-256 Hash (using Apps Script native function)
function hashPassword(password) {
  const signature = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password
  );
  return Utilities.base64Encode(signature);
}

function verifyPassword(password, hash) {
  const newHash = hashPassword(password);
  // Trim whitespace from stored hash (Google Sheets sometimes adds spaces)
  const storedHash = String(hash).trim();
  const computedHash = newHash.trim();
  return computedHash === storedHash;
}

// ===== AUTH HANDLERS =====
function handleSignup(data) {
  try {
    // Validate configuration
    validateConfig();
    
    // Validate input
    if (!data.name || !data.email || !data.phone || !data.address || !data.password) {
      return { success: false, error: 'Missing required fields' };
    }

    // Validate email format
    if (!data.email.includes('@')) {
      return { success: false, error: 'Invalid email format' };
    }

    // Check if user already exists
    const existingUser = findRowByValue(SHEET_NAMES.users, 'email', data.email);
    if (existingUser) {
      return { success: false, error: 'Email already registered' };
    }

    const sheet = getSheet(SHEET_NAMES.users);
    if (!sheet) {
      return { success: false, error: 'Users sheet not found. Please check your Google Sheet setup.' };
    }

    const newRow = [
      generateId(),
      data.name,
      data.phone,
      data.email,
      data.address,
      hashPassword(data.password)
    ];

    sheet.appendRow(newRow);

    // ensure the user has a placeholder donation record so they appear in the
    // admin donations list right after signing up
    ensureDonationRecord(data.email);

    return { success: true, message: 'User registered successfully. You can now login.' };
  } catch (error) {
    return { success: false, error: 'Signup error: ' + error.toString() };
  }
}

function handleLogin(data) {
  if (!data.email || !data.password) {
    return { success: false, error: 'Email and password required' };
  }

  try {
    // Validate configuration
    validateConfig();

    const user = findRowByValue(SHEET_NAMES.users, 'email', data.email);

    if (!user) {
      return { success: false, error: 'User not found. Please sign up first.' };
    }

    const headers = getSheetHeaders(SHEET_NAMES.users);
    const passwordHashIndex = getColumnIndex(SHEET_NAMES.users, 'passwordHash');

    if (passwordHashIndex === -1) {
      return { success: false, error: 'Sheet misconfigured: passwordHash column not found' };
    }

    if (!verifyPassword(data.password, user.data[passwordHashIndex])) {
      return { success: false, error: 'Invalid password' };
    }

    const nameIndex = getColumnIndex(SHEET_NAMES.users, 'name');

    // make sure the user has a donation record even if they never signed up
    ensureDonationRecord(data.email);

    return {
      success: true,
      user: {
        email: data.email,
        name: user.data[nameIndex],
        role: 'user'
      }
    };
  } catch (error) {
    return { success: false, error: 'Login error: ' + error.toString() };
  }
}

// ===== LEADER HANDLERS =====
function handleGetLeaders() {
  try {
    const sheet = getSheet(SHEET_NAMES.leaders);
    if (!sheet) return { success: false, error: 'Leaders sheet not found' };

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const leaders = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) { // Check if ID exists
        leaders.push({
          id: data[i][0],
          name: data[i][1],
          title: data[i][2],
          photoURL: data[i][3],
          description: data[i][4]
        });
      }
    }

    return { success: true, leaders: leaders };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

function handleCreateLeader(data) {
  if (!data.name || !data.title || !data.photoURL || !data.description) {
    return { success: false, error: 'Missing required fields' };
  }

  try {
    const sheet = getSheet(SHEET_NAMES.leaders);
    const newRow = [
      generateId(),
      data.name,
      data.title,
      data.photoURL,
      data.description
    ];

    sheet.appendRow(newRow);
    return { success: true, message: 'Leader created' };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

function handleUpdateLeader(data) {
  if (!data.id || !data.name || !data.title || !data.photoURL || !data.description) {
    return { success: false, error: 'Missing required fields' };
  }

  try {
    const sheet = getSheet(SHEET_NAMES.leaders);
    const sheetData = sheet.getDataRange().getValues();

    for (let i = 1; i < sheetData.length; i++) {
      if (sheetData[i][0] === data.id) {
        sheet.getRange(i + 1, 1, 1, 5).setValues([[
          data.id,
          data.name,
          data.title,
          data.photoURL,
          data.description
        ]]);
        return { success: true, message: 'Leader updated' };
      }
    }

    return { success: false, error: 'Leader not found' };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

function handleDeleteLeader(data) {
  if (!data.id) {
    return { success: false, error: 'Leader ID required' };
  }

  try {
    const sheet = getSheet(SHEET_NAMES.leaders);
    const sheetData = sheet.getDataRange().getValues();

    for (let i = 1; i < sheetData.length; i++) {
      if (sheetData[i][0] === data.id) {
        sheet.deleteRow(i + 1);
        return { success: true, message: 'Leader deleted' };
      }
    }

    return { success: false, error: 'Leader not found' };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// ===== DONATION HANDLERS =====
function handleGetDonations(data) {
  try {
    const sheet = getSheet(SHEET_NAMES.donations);
    if (!sheet) return { success: false, error: 'Donations sheet not found' };

    // make sure necessary headers exist before we read any rows
    ensureDonationHeaders();

    const sheetData = sheet.getDataRange().getValues();
    if (sheetData.length <= 1) {
      return { success: true, donations: [] };
    }
    let headers = sheetData[0];
    // normalise headers to lowercase for easier matching
    const lowerHeaders = headers.map(h => String(h).toLowerCase());

    // helper to read a value by header name (case-insensitive)
    const getValue = (row, name) => {
      const idx = lowerHeaders.indexOf(String(name).toLowerCase());
      return idx >= 0 ? row[idx] : '';
    };

    let donations = [];

    // iterate rows once and pick according to criteria
    for (let i = 1; i < sheetData.length; i++) {
      const row = sheetData[i];
      const idVal = getValue(row, 'id');
      if (!idVal) continue; // skip empty rows

      let emailVal = getValue(row, 'email');
      const monthVal = getValue(row, 'month');
      const statusVal = getValue(row, 'status');
      const amountVal = getValue(row, 'amount');

      // fallback: if email column empty or doesn't match, scan entire row for the email
      if ((!emailVal || String(emailVal).trim() === '') && data.email) {
        for (let c = 0; c < row.length; c++) {
          if (String(row[c]).toLowerCase() === String(data.email).toLowerCase()) {
            emailVal = data.email;
            // correct sheet value if email column exists but was empty
            const emailIdx = lowerHeaders.indexOf('email');
            if (emailIdx !== -1 && (!row[emailIdx] || String(row[emailIdx]).trim() === '')) {
              const sheet = getSheet(SHEET_NAMES.donations);
              sheet.getRange(i + 1, emailIdx + 1).setValue(data.email);
            }
            break;
          }
        }
      }

      // case-insensitive email comparison
      const emailMatch = data.email ? String(emailVal).toLowerCase() === String(data.email).toLowerCase() : false;
      if (data.allRecords || (data.email && emailMatch)) {
        const donation = {
          id: idVal,
          email: emailVal,
          month: monthVal,
          status: statusVal,
          amount: amountVal,
          userName: '' // initialize default
        };

        // always attempt to attach user name from the donations row or users sheet
        const nameVal = getValue(row, 'name');
        if (nameVal && String(nameVal).trim()) {
          donation.userName = String(nameVal).trim();
        } else if (emailVal) {
          // fallback: lookup from users sheet
          try {
            const userRow = findRowByValue(SHEET_NAMES.users, 'email', emailVal);
            if (userRow) {
              const nameIdx = getColumnIndex(SHEET_NAMES.users, 'name');
              if (nameIdx >= 0) {
                donation.userName = String(userRow.data[nameIdx] || '').trim();
              }
            }
          } catch (e) {
            // silently ignore lookup errors
          }
        }

        // for admin responses attempt to include other user details
        if (data.allRecords && emailVal) {
          try {
            const userRow = findRowByValue(SHEET_NAMES.users, 'email', emailVal);
            if (userRow) {
              const phoneIdx = getColumnIndex(SHEET_NAMES.users, 'phone');
              const addressIdx = getColumnIndex(SHEET_NAMES.users, 'address');
              if (phoneIdx >= 0) donation.userPhone = String(userRow.data[phoneIdx] || '').trim();
              if (addressIdx >= 0) donation.userAddress = String(userRow.data[addressIdx] || '').trim();
            }
          } catch (e) {
            // silently ignore lookup errors
          }
        }

        donations.push(donation);
      }
    }

    // if filtering by a specific email, eliminate duplicates (same month) that may linger from malformed rows
    if (!data.allRecords && data.email) {
      const seen = {};
      donations = donations.filter(d => {
        const key = String(d.email || '').toLowerCase() + '|' + String(d.month || '');
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    return { success: true, donations: donations };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

function handleUpdateDonation(data) {
  // only admin requests should be allowed
  if (!data.isAdmin) {
    return { success: false, error: 'Unauthorized: admin privileges required' };
  }

  if (!data.id || !data.status) {
    return { success: false, error: 'Missing required fields' };
  }

  try {
    const sheet = getSheet(SHEET_NAMES.donations);
    const sheetData = sheet.getDataRange().getValues();
    const headers = sheetData[0] || [];
    const lowerHeaders = headers.map(h => String(h).toLowerCase());

    // determine indices of columns we need to update
    const statusIdx = lowerHeaders.indexOf('status');
    const amountIdx = lowerHeaders.indexOf('amount');
    
    if (statusIdx === -1) {
      return { success: false, error: 'Donations sheet misconfigured: status column not found' };
    }

    for (let i = 1; i < sheetData.length; i++) {
      if (sheetData[i][0] === data.id) {
        // Update status
        sheet.getRange(i + 1, statusIdx + 1).setValue(data.status);
        
        // Update amount if provided
        if (data.amount && amountIdx !== -1) {
          sheet.getRange(i + 1, amountIdx + 1).setValue(data.amount);
        }
        
        return { success: true, message: 'Donation updated successfully' };
      }
    }

    return { success: false, error: 'Donation not found' };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// ===== MESSAGE HANDLERS =====
function handleCreateMessage(data) {
  if (!data.name || !data.phone || !data.address || !data.message) {
    return { success: false, error: 'Missing required fields' };
  }

  try {
    const sheet = getSheet(SHEET_NAMES.messages);
    const newRow = [
      generateId(),
      data.name,
      data.phone,
      data.address,
      data.message,
      generateTimestamp()
    ];

    sheet.appendRow(newRow);
    return { success: true, message: 'Message saved' };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

function handleGetMessages() {
  try {
    const sheet = getSheet(SHEET_NAMES.messages);
    if (!sheet) return { success: false, error: 'Messages sheet not found' };

    const sheetData = sheet.getDataRange().getValues();

    const messages = [];
    for (let i = 1; i < sheetData.length; i++) {
      if (sheetData[i][0]) {
        messages.push({
          id: sheetData[i][0],
          name: sheetData[i][1],
          phone: sheetData[i][2],
          address: sheetData[i][3],
          message: sheetData[i][4],
          timestamp: sheetData[i][5],
          read: sheetData[i][6] || false
        });
      }
    }

    return { success: true, messages: messages };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// ===== STATS HANDLERS =====
function handleGetStats() {
  try {
    const usersSheet = getSheet(SHEET_NAMES.users);
    const leadersSheet = getSheet(SHEET_NAMES.leaders);
    const messagesSheet = getSheet(SHEET_NAMES.messages);
    const donationsSheet = getSheet(SHEET_NAMES.donations);

    const getUserCount = () => {
      const data = usersSheet.getDataRange().getValues();
      return Math.max(0, data.length - 1);
    };

    const getLeaderCount = () => {
      const data = leadersSheet.getDataRange().getValues();
      return Math.max(0, data.length - 1);
    };

    const getMessageCount = () => {
      const data = messagesSheet.getDataRange().getValues();
      return Math.max(0, data.length - 1);
    };

    const getDonationCount = () => {
      const data = donationsSheet.getDataRange().getValues();
      return Math.max(0, data.length - 1);
    };

    return {
      success: true,
      userCount: getUserCount(),
      leaderCount: getLeaderCount(),
      messageCount: getMessageCount(),
      donationCount: getDonationCount()
    };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// ===== TEST FUNCTION =====
function testDeployment() {
  const result = handleGetStats();
  Logger.log('Deployment test: ' + JSON.stringify(result));
}
