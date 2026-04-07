// ============================================================
// Second City Scrubbers — Booking Automation
// Google Apps Script
//
// SETUP INSTRUCTIONS:
// 1. Go to https://script.google.com and create a new project
// 2. Delete any existing code and paste this entire file
// 3. Click Save (Ctrl+S)
// 4. Click Deploy > New Deployment
// 5. Select type: Web App
// 6. Set "Execute as": Me
// 7. Set "Who has access": Anyone
// 8. Click Deploy and copy the Web App URL
// 9. Paste that URL into index.html where it says APPS_SCRIPT_URL
// 10. On first deploy, Google will ask you to authorize — click through
// ============================================================

const OWNER_EMAIL = 'michel@secondcityscrubbers.com';
const REVIEW_LINK = 'https://g.page/r/CUm8G8bTKu2kEBM/review';
const SHEET_ID    = '1-6dBANyYIWMMcMVAUzrd5kMWNWMCyFORn46zk-0Amww';

// ── Entry point ──────────────────────────────────────────────
function doPost(e) {
  try {
    const d = e.parameter;

    const firstName  = d.first_name        || '';
    const lastName   = d.last_name         || '';
    const email      = d.email             || '';
    const phone      = d.phone             || '';
    const address    = d.service_address   || '';
    const service    = d.service_type      || '';
    const size       = d.home_size         || '';
    const frequency  = d.booking_frequency || '';
    const dateStr    = d.preferred_date    || '';
    const timeStr    = d.preferred_time    || '';
    const notes      = d.notes             || '';
    const discount   = d.discount          || '';
    const referredBy = d.referred_by       || '';
    const estPrice   = d.estimated_price   || '';

    const fullName     = (firstName + ' ' + lastName).trim();
    const startDT      = parseDateTime(dateStr, timeStr);
    const endDT        = new Date(startDT.getTime() + 3 * 60 * 60 * 1000); // +3 hours

    createCalendarEvent(fullName, email, phone, address, service, size, frequency, notes, estPrice, startDT, endDT);
    sendConfirmationEmail(email, firstName, service, size, dateStr, timeStr, address, estPrice);
    sendOwnerNotification(fullName, email, phone, address, service, size, frequency, dateStr, timeStr, notes, discount, referredBy, estPrice);
    scheduleReminder(email, firstName, service, address, dateStr, timeStr, startDT);
    scheduleReviewRequest(email, firstName, endDT);
    logToSheet(fullName, email, phone, address, service, size, frequency, dateStr, timeStr, estPrice, discount, referredBy, notes);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Helpers ──────────────────────────────────────────────────
function parseDateTime(dateStr, timeStr) {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  let hours = 9, minutes = 0;
  if (timeStr) {
    const m = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (m) {
      hours   = parseInt(m[1]);
      minutes = parseInt(m[2]);
      if (m[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
      if (m[3].toUpperCase() === 'AM' && hours === 12) hours  = 0;
    }
  }
  return new Date(year, month - 1, day, hours, minutes, 0);
}

function serviceLabel(val) {
  return ({
    standard:      'Standard Clean',
    deep:          'Deep Clean',
    moveinout:     'Move-In / Move-Out',
    airbnb:        'Airbnb / Short-Term Rental',
    postconstruct: 'Post-Construction',
    commercial:    'Commercial / Large Project'
  })[val] || val;
}

function sizeLabel(val) {
  return ({
    studio: 'Studio / 1 Bedroom',
    '2br':  '2 Bedrooms',
    '3br':  '3 Bedrooms',
    '4br':  '4+ Bedrooms'
  })[val] || val;
}

// ── Calendar ─────────────────────────────────────────────────
function createCalendarEvent(fullName, email, phone, address, service, size, frequency, notes, estPrice, start, end) {
  const cal   = CalendarApp.getDefaultCalendar();
  const title = '🧹 ' + serviceLabel(service) + ' — ' + fullName;
  const desc  = [
    'Client:    ' + fullName,
    'Email:     ' + email,
    'Phone:     ' + phone,
    'Address:   ' + address,
    'Service:   ' + serviceLabel(service),
    'Size:      ' + sizeLabel(size),
    'Frequency: ' + frequency,
    estPrice   ? 'Estimate:  ' + estPrice : '',
    notes      ? '\nNotes:\n'  + notes    : '',
  ].filter(Boolean).join('\n');

  cal.createEvent(title, start, end, { description: desc, location: address });
}

// ── Emails ───────────────────────────────────────────────────
function sendConfirmationEmail(toEmail, firstName, service, size, dateStr, timeStr, address, estPrice) {
  MailApp.sendEmail({
    to:      toEmail,
    subject: 'Booking Confirmed — Second City Scrubbers',
    body:
`Hi ${firstName},

Thanks for choosing Second City Scrubbers! We've received your request and will confirm within 2 hours.

YOUR BOOKING DETAILS
────────────────────
Service:  ${serviceLabel(service)}
Size:     ${sizeLabel(size)}
Date:     ${dateStr}
Time:     ${timeStr}
Address:  ${address}
${estPrice ? 'Estimate: ' + estPrice : ''}

No payment is collected today. We confirm first, clean your home, then you pay.

Questions? Reply to this email or call us at (872) 240-6619.

See you soon,
Michel
Second City Scrubbers
(872) 240-6619
secondcityscrubbers.com`,
    name:    'Second City Scrubbers',
    replyTo: OWNER_EMAIL
  });
}

function sendOwnerNotification(fullName, email, phone, address, service, size, frequency, dateStr, timeStr, notes, discount, referredBy, estPrice) {
  const lines = [
    'NEW BOOKING REQUEST',
    '────────────────────',
    'Name:      ' + fullName,
    'Email:     ' + email,
    'Phone:     ' + phone,
    'Address:   ' + address,
    'Service:   ' + serviceLabel(service),
    'Size:      ' + sizeLabel(size),
    'Frequency: ' + frequency,
    'Date:      ' + dateStr,
    'Time:      ' + timeStr,
    estPrice   ? 'Estimate:  ' + estPrice   : '',
    discount   ? 'Discount:  ' + discount   : '',
    referredBy ? 'Referred:  ' + referredBy : '',
    notes      ? '\nNotes:\n'  + notes      : '',
  ].filter(Boolean);

  MailApp.sendEmail({
    to:      OWNER_EMAIL,
    subject: 'New Booking — ' + fullName + ' — ' + dateStr + ' ' + timeStr,
    body:    lines.join('\n')
  });
}

// ── Scheduled emails ─────────────────────────────────────────
function scheduleReminder(toEmail, firstName, service, address, dateStr, timeStr, startDT) {
  const fireAt = new Date(startDT.getTime() - 24 * 60 * 60 * 1000);
  if (fireAt <= new Date()) return; // Job is less than 24h away, skip

  const key = 'reminder_' + Date.now();
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({
    type: 'reminder', toEmail, firstName, service, address, dateStr, timeStr
  }));
  const trigger = ScriptApp.newTrigger('runScheduledEmail').timeBased().at(fireAt).create();
  PropertiesService.getScriptProperties().setProperty('tid_' + trigger.getUniqueId(), key);
}

function scheduleReviewRequest(toEmail, firstName, endDT) {
  const fireAt = new Date(endDT.getTime() + 4 * 60 * 60 * 1000); // 4h after job ends
  if (fireAt <= new Date()) return;

  const key = 'review_' + Date.now();
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({
    type: 'review', toEmail, firstName
  }));
  const trigger = ScriptApp.newTrigger('runScheduledEmail').timeBased().at(fireAt).create();
  PropertiesService.getScriptProperties().setProperty('tid_' + trigger.getUniqueId(), key);
}

function runScheduledEmail(e) {
  const tid   = e.triggerUid;
  const props = PropertiesService.getScriptProperties();
  const key   = props.getProperty('tid_' + tid);
  if (!key) return;

  const data = JSON.parse(props.getProperty(key) || '{}');

  if (data.type === 'reminder') {
    MailApp.sendEmail({
      to:      data.toEmail,
      subject: 'Reminder: Your Clean is Tomorrow — Second City Scrubbers',
      body:
`Hi ${data.firstName},

Just a friendly reminder that your ${serviceLabel(data.service)} is scheduled for tomorrow.

Date:     ${data.dateStr}
Time:     ${data.timeStr}
Address:  ${data.address}

A few tips to help us do our best work:
  • Clear countertops and surfaces if possible
  • Secure or contain pets during the clean
  • Leave any access instructions in a reply if needed

Questions? Reply here or call (872) 240-6619.

See you tomorrow,
Michel
Second City Scrubbers`,
      name:    'Second City Scrubbers',
      replyTo: OWNER_EMAIL
    });
  }

  if (data.type === 'review') {
    MailApp.sendEmail({
      to:      data.toEmail,
      subject: 'How did we do? — Second City Scrubbers',
      body:
`Hi ${data.firstName},

Hope your home is feeling fresh! We'd love to hear how your clean went.

If you have 30 seconds, a Google review makes a huge difference for a small local business like ours:

${REVIEW_LINK}

It truly means the world to us. And if anything wasn't perfect, just reply to this email — we'll make it right.

Thank you for choosing Second City Scrubbers.

Michel
Second City Scrubbers
(872) 240-6619`,
      name:    'Second City Scrubbers',
      replyTo: OWNER_EMAIL
    });
  }

  // Clean up
  props.deleteProperty(key);
  props.deleteProperty('tid_' + tid);
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getUniqueId() === tid) ScriptApp.deleteTrigger(t);
  });
}

// ── CRM Sheet ────────────────────────────────────────────────
function logToSheet(fullName, email, phone, address, service, size, frequency, dateStr, timeStr, estPrice, discount, referredBy, notes) {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    let sheet   = ss.getSheetByName('Bookings');

    // Create sheet + headers on first use
    if (!sheet) {
      sheet = ss.insertSheet('Bookings');
      sheet.appendRow([
        'Date Submitted', 'Name', 'Email', 'Phone', 'Address',
        'Service', 'Size', 'Frequency', 'Preferred Date', 'Preferred Time',
        'Estimate', 'Discount', 'Referred By', 'Notes', 'Status'
      ]);
      sheet.getRange(1, 1, 1, 15).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      new Date(),
      fullName,
      email,
      phone,
      address,
      serviceLabel(service),
      sizeLabel(size),
      frequency,
      dateStr,
      timeStr,
      estPrice,
      discount,
      referredBy,
      notes,
      'Pending' // You can manually update this to Confirmed / Completed / Cancelled
    ]);
  } catch (err) {
    // Sheet logging failure should not break the booking
    MailApp.sendEmail(OWNER_EMAIL, 'Sheet Log Error', err.message);
  }
}
