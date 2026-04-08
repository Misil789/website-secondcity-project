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
//
// GOOGLE SHEETS CRM SETUP:
// 1. Go to sheets.google.com and create a new blank spreadsheet
// 2. Name it "SCS CRM" (or anything you like)
// 3. Copy the ID from the URL:
//    https://docs.google.com/spreadsheets/d/COPY_THIS_PART/edit
// 4. Paste it below as SHEET_ID
// 5. The script will auto-create Bookings, Quotes, and Leads tabs
// ============================================================

const OWNER_EMAIL = 'michel@secondcityscrubbers.com';
const REVIEW_LINK = 'https://g.page/r/CUm8G8bTKu2kEBM/review';
const SHEET_ID    = '1HHc4UBaHbR_HyQ3WWjkO52od9wFD0F4BaAcbdaG0Seo';

// ── Entry point ──────────────────────────────────────────────
function doPost(e) {
  try {
    // Log everything arriving so we can diagnose missing fields
    Logger.log('RAW postData: ' + (e.postData ? e.postData.contents : 'none'));
    Logger.log('ALL parameters: ' + JSON.stringify(e.parameter));

    const d = e.parameter;
    const formType = d.form_type || 'booking';
    Logger.log('form_type: ' + formType);
    Logger.log('email: ' + d.email);
    Logger.log('first_name: ' + d.first_name);

    if (formType === 'quote') return handleQuote(d);
    if (formType === 'lead')  return handleLead(d);

    // Default: full booking
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

    Logger.log('fullName: ' + fullName + ' | email: ' + email + ' | estPrice: ' + estPrice);

    // Send emails first — these must not be blocked by calendar/sheet failures
    Logger.log('Sending confirmation to: ' + email);
    sendConfirmationEmail(email, firstName, service, size, dateStr, timeStr, address, estPrice);
    sendOwnerNotification(fullName, email, phone, address, service, size, frequency, dateStr, timeStr, notes, discount, referredBy, estPrice);
    sendInvoiceEmail(email, firstName, fullName, service, size, dateStr, timeStr, address, estPrice);

    // Calendar, triggers, and CRM — wrapped so failures don't affect emails above
    try { createCalendarEvent(fullName, email, phone, address, service, size, frequency, notes, estPrice, startDT, endDT); } catch(err) { Logger.log('Calendar error: ' + err.message); }
    try { scheduleRecurringEvents(fullName, email, phone, address, service, size, frequency, notes, estPrice, startDT); } catch(err) { Logger.log('Recurring error: ' + err.message); }
    try { scheduleReminder(email, firstName, service, address, dateStr, timeStr, startDT); } catch(err) { Logger.log('Reminder error: ' + err.message); }
    try { scheduleReviewRequest(email, firstName, endDT); } catch(err) { Logger.log('Review trigger error: ' + err.message); }
    try { cancelQuoteFollowup(email); } catch(err) { Logger.log('Cancel followup error: ' + err.message); }
    try { logBooking(fullName, email, phone, address, service, size, frequency, dateStr, timeStr, estPrice, discount, referredBy, notes); } catch(err) { Logger.log('Sheet error: ' + err.message); }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── GET handler (health check) ───────────────────────────────
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'Apps Script is live' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Quote request ─────────────────────────────────────────────
function handleQuote(d) {
  const firstName = d.first_name   || '';
  const lastName  = d.last_name    || '';
  const email     = d.email        || '';
  const phone     = d.phone        || '';
  const service   = d.service_type || '';
  const message   = d.message      || '';
  const fullName  = (firstName + ' ' + lastName).trim();

  MailApp.sendEmail({
    to:      OWNER_EMAIL,
    subject: 'New Quote Request — ' + fullName,
    body:    [
      'NEW QUOTE REQUEST',
      '─────────────────',
      'Name:    ' + fullName,
      'Email:   ' + email,
      'Phone:   ' + phone,
      'Service: ' + service,
      message ? '\nDetails:\n' + message : '',
    ].filter(Boolean).join('\n')
  });

  scheduleQuoteFollowup(email, firstName, service);
  logQuote(fullName, email, phone, service, message);

  if (email) {
    MailApp.sendEmail({
      to:      email,
      subject: 'We got your quote request — Second City Scrubbers',
      body:
`Hi ${firstName},

Thanks for reaching out! We received your free quote request and will get back to you within 24 hours.

Service: ${service}
${message ? 'Details: ' + message + '\n' : ''}
Questions in the meantime? Call us at (872) 240-6619.

Talk soon,
Michel
Second City Scrubbers
(872) 240-6619
secondcityscrubbers.com`,
      name:    'Second City Scrubbers',
      replyTo: OWNER_EMAIL
    });
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Lead capture (popup $20 off) ──────────────────────────────
function handleLead(d) {
  const email = d.email || '';

  MailApp.sendEmail({
    to:      OWNER_EMAIL,
    subject: 'New $20 Off Lead — ' + email,
    body:    'New discount lead captured from popup.\n\nEmail: ' + email
  });
  logLead(email);

  if (email) {
    MailApp.sendEmail({
      to:      email,
      subject: 'Your $20 Off Coupon — Second City Scrubbers',
      body:
`Hi there,

Welcome! Here's your $20 off your first clean — just mention this email when you book.

Book online: https://secondcityscrubbers.com/#booking
Or call: (872) 240-6619

We can't wait to make your home shine.

Michel
Second City Scrubbers
(872) 240-6619
secondcityscrubbers.com`,
      name:    'Second City Scrubbers',
      replyTo: OWNER_EMAIL
    });
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Invoice email ─────────────────────────────────────────────
function sendInvoiceEmail(toEmail, firstName, fullName, service, size, dateStr, timeStr, address, estPrice) {
  if (!toEmail || !estPrice) return;
  const invoiceNum = 'SCS-' + Date.now().toString().slice(-6);
  const today      = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  MailApp.sendEmail({
    to:      toEmail,
    subject: 'Invoice ' + invoiceNum + ' — Second City Scrubbers',
    body:
`INVOICE
────────────────────────────────────
Second City Scrubbers
(872) 240-6619 | secondcityscrubbers.com
michel@secondcityscrubbers.com

Invoice #:  ${invoiceNum}
Date:       ${today}
────────────────────────────────────

BILL TO
${fullName}
${address}

SERVICE DETAILS
Service:    ${serviceLabel(service)}
Home Size:  ${sizeLabel(size)}
Date:       ${dateStr}
Time:       ${timeStr}

────────────────────────────────────
TOTAL DUE:  ${estPrice}
────────────────────────────────────

PAYMENT OPTIONS
• Zelle:   (872) 240-6619
• Cash:    Accepted at time of service

Payment is due at time of service. Thank you for choosing Second City Scrubbers!

Questions? Reply to this email or call (872) 240-6619.

Michel
Second City Scrubbers`,
    name:    'Second City Scrubbers',
    replyTo: OWNER_EMAIL
  });
}

// ── Google Sheets CRM ─────────────────────────────────────────
function getOrCreateSheet(name, headers) {
  if (SHEET_ID === 'PASTE_YOUR_SHEET_ID_HERE') return null;
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    let sheet   = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
           .setFontWeight('bold')
           .setBackground('#0ea5e9')
           .setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
    return sheet;
  } catch(err) {
    Logger.log('Sheet error: ' + err.message);
    return null;
  }
}

function logBooking(fullName, email, phone, address, service, size, frequency, dateStr, timeStr, estPrice, discount, referredBy, notes) {
  const sheet = getOrCreateSheet('Bookings', [
    'Date Logged', 'Name', 'Email', 'Phone', 'Address',
    'Service', 'Size', 'Frequency', 'Job Date', 'Job Time',
    'Estimate', 'Discount', 'Referred By', 'Notes'
  ]);
  if (!sheet) return;
  sheet.appendRow([
    new Date(), fullName, email, phone, address,
    serviceLabel(service), sizeLabel(size), frequency, dateStr, timeStr,
    estPrice, discount, referredBy, notes
  ]);
}

function logQuote(fullName, email, phone, service, message) {
  const sheet = getOrCreateSheet('Quotes', [
    'Date Logged', 'Name', 'Email', 'Phone', 'Service', 'Message'
  ]);
  if (!sheet) return;
  sheet.appendRow([new Date(), fullName, email, phone, service, message]);
}

function logLead(email) {
  const sheet = getOrCreateSheet('Leads', ['Date Logged', 'Email', 'Source']);
  if (!sheet) return;
  sheet.appendRow([new Date(), email, '$20 Off Popup']);
}

// ── Recurring events ─────────────────────────────────────────
function scheduleRecurringEvents(fullName, email, phone, address, service, size, frequency, notes, estPrice, firstStart) {
  const f = (frequency || '').toLowerCase();
  let intervalDays = 0, occurrences = 0;

  if      (f.includes('week') && !f.includes('bi') && !f.includes('every 2')) { intervalDays = 7;  occurrences = 11; } // weekly → 12 total
  else if (f.includes('bi') || f.includes('every 2') || f.includes('2 week')) { intervalDays = 14; occurrences = 5;  } // biweekly → 6 total
  else if (f.includes('month'))                                                { intervalDays = 30; occurrences = 2;  } // monthly → 3 total

  if (!intervalDays) return; // one-time or unrecognized — nothing to schedule

  const duration = 3 * 60 * 60 * 1000;
  for (let i = 1; i <= occurrences; i++) {
    const start = new Date(firstStart.getTime() + i * intervalDays * 24 * 60 * 60 * 1000);
    const end   = new Date(start.getTime() + duration);
    createCalendarEvent(fullName, email, phone, address, service, size, frequency, notes, estPrice, start, end);
  }
}

// ── Quote follow-up ───────────────────────────────────────────
function scheduleQuoteFollowup(email, firstName, service) {
  if (!email) return;
  const props  = PropertiesService.getScriptProperties();
  const fireAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const key    = 'qf_' + Date.now();

  props.setProperty(key, JSON.stringify({ type: 'quote_followup', toEmail: email, firstName, service }));
  const trigger = ScriptApp.newTrigger('runScheduledEmail').timeBased().at(fireAt).create();
  props.setProperty('tid_' + trigger.getUniqueId(), key);
  // Store email → key so we can cancel if they book
  props.setProperty('qf_email_' + email.trim().toLowerCase(), key);
}

function cancelQuoteFollowup(email) {
  if (!email) return;
  const props    = PropertiesService.getScriptProperties();
  const emailKey = 'qf_email_' + email.trim().toLowerCase();
  const dataKey  = props.getProperty(emailKey);
  if (!dataKey) return;

  // Find and delete the matching trigger
  const allProps = props.getProperties();
  Object.keys(allProps).forEach(k => {
    if (k.startsWith('tid_') && allProps[k] === dataKey) {
      const tid = k.slice(4);
      ScriptApp.getProjectTriggers().forEach(t => {
        if (t.getUniqueId() === tid) ScriptApp.deleteTrigger(t);
      });
      props.deleteProperty(k);
    }
  });
  props.deleteProperty(dataKey);
  props.deleteProperty(emailKey);
}

// ── Weekly summary report ─────────────────────────────────────
// Call this once manually or set a weekly time-based trigger pointing to it.
// Summarizes the upcoming 7 days of calendar events tagged with 🧹
function sendWeeklySummary() {
  const now   = new Date();
  const end   = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const cal   = CalendarApp.getDefaultCalendar();
  const events = cal.getEvents(now, end).filter(ev => ev.getTitle().startsWith('🧹'));

  const lines = [
    'WEEKLY SUMMARY — ' + now.toDateString(),
    '─────────────────────────────────',
    'Upcoming jobs this week: ' + events.length,
    '',
  ];

  events.forEach(ev => {
    lines.push(ev.getStartTime().toDateString() + ' ' + ev.getStartTime().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    lines.push('  ' + ev.getTitle().replace('🧹 ', ''));
    lines.push('  ' + (ev.getLocation() || 'No address'));
    lines.push('');
  });

  if (events.length === 0) lines.push('No jobs scheduled for the upcoming week.');

  MailApp.sendEmail({
    to:      OWNER_EMAIL,
    subject: 'Weekly Job Summary — Second City Scrubbers',
    body:    lines.join('\n'),
    name:    'Second City Scrubbers'
  });
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
  if (!toEmail) { Logger.log('sendConfirmationEmail: toEmail is empty, skipping'); return; }
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

  if (data.type === 'quote_followup') {
    MailApp.sendEmail({
      to:      data.toEmail,
      subject: 'Still thinking it over? — Second City Scrubbers',
      body:
`Hi ${data.firstName},

Just checking in — we sent over some info about ${data.service} a couple days ago and wanted to make sure you got it.

If you have any questions about pricing, scheduling, or what's included, just reply to this email or give us a call at (872) 240-6619. We're happy to help.

Ready to book? You can do it online in 2 minutes:
https://secondcityscrubbers.com/#booking

No pressure at all — just want to make sure you have everything you need.

Michel
Second City Scrubbers
(872) 240-6619`,
      name:    'Second City Scrubbers',
      replyTo: OWNER_EMAIL
    });
    // Clean up the email → key mapping too
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('qf_email_' + (data.toEmail || '').trim().toLowerCase());
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

