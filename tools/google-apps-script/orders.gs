/**
 * ORÉ — order inbox (Google Apps Script)
 *
 * Every order placed on the site arrives here. The script:
 *   1. adds a row to the "הזמנות" sheet (with a status dropdown you update),
 *   2. emails you the full order,
 *   3. emails the customer an order confirmation (when she gave an email).
 *
 * Protection: a limit on orders per hour and confirmation emails per day, a trap
 * field for bots, duplicate blocking, formula blocking in the sheet, and a check that
 * the sums add up (and, once SITE_URL is set, that prices match the live site).
 *
 * Setup steps (in Hebrew) are in docs/orders-setup.md.
 * The only line you need to edit is OWNER_EMAIL below.
 */

const OWNER_EMAIL = 'oreoffice.shop@gmail.com';
// Only if you created the script from script.google.com (not from inside the sheet):
// paste the sheet's ID here — the long code in the sheet's address between /d/ and /edit.
const SHEET_ID = '';
// The live site address, once it is online (e.g. 'https://ore-candles.pages.dev').
// When set, every order's prices are checked against the site's product list.
const SITE_URL = '';
const MAX_ORDERS_PER_HOUR = 15;          // more than this in an hour is almost surely abuse
const MAX_CUSTOMER_EMAILS_PER_DAY = 40;  // protects the Gmail account from being used for spam
const SHOP_NAME = 'ORÉ';
// The round logo, embedded so it shows inside the emails (JPEG, base64).
const LOGO_B64 = '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';
const WHATSAPP = '052-254-3585';
const SHEET_NAME = 'הזמנות';
const STATUSES = ['חדשה', 'ממתינה לתשלום', 'שולם', 'בהכנה', 'נשלחה', 'נמסרה', 'בוטלה'];
const HEADERS = ['תאריך', 'מספר הזמנה', 'סטטוס', 'שם', 'טלפון', 'מייל', 'מוצרים', 'סכום ביניים', 'הנחה', 'קופון',
  'משלוח', 'עלות משלוח', 'סה"כ', 'תשלום', 'כתובת', 'ברכה למתנה', 'הערות', 'בדיקת סכומים'];

/** Run this once from the editor (Run ▶ setup) to create the sheet and approve permissions. */
function setup() {
  sheet_();
  MailApp.getRemainingDailyQuota(); // asks for the email permission now, not on the first order
}

/** Receives an order from the website. */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const raw = JSON.parse(e.postData.contents);
    if (raw.hp) return json_({ ok: true });                       // trap field filled: a bot
    if (!allow_('orders-hour', MAX_ORDERS_PER_HOUR, 3600)) return json_({ ok: false, error: 'too many orders' });
    const o = clean_(raw);
    if (seen_(o.no)) return json_({ ok: true, duplicate: true }); // same order sent twice
    const issues = verify_(o);
    const sh = sheet_();
    const address = o.needsAddress ? [o.customer.street, o.customer.apt, o.customer.city].filter(String).join(', ') : '';
    sh.appendRow([
      new Date(o.date || Date.now()), safe_(o.no), STATUSES[0], safe_(o.customer.name), "'" + o.customer.phone, safe_(o.customer.email),
      safe_(o.items.map(i => `${i.name}${i.options ? ' (' + i.options + ')' : ''} × ${i.qty}`).join('\n')),
      o.subtotal, o.discount, safe_(o.coupon), safe_(o.shipping), o.shippingCost, o.total, safe_(o.payment), safe_(address),
      safe_(o.gift), safe_(o.notes), issues.length ? '⚠️ ' + issues.join(' · ') : 'תקין'
    ]);

    MailApp.sendEmail({
      to: OWNER_EMAIL,
      subject: `${issues.length ? '⚠️ לבדיקה: ' : ''}הזמנה חדשה ${o.no} · ${money_(o.total)} · ${o.customer.name}`,
      htmlBody: ownerEmail_(o, address, issues),
      name: SHOP_NAME + ' – הזמנות',
      inlineImages: { orelogo: logo_() },
      replyTo: o.customer.email || OWNER_EMAIL
    });
    if (o.customer.email && allow_('customer-mail-' + Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyyMMdd'), MAX_CUSTOMER_EMAILS_PER_DAY, 86400)) {
      MailApp.sendEmail({
        to: o.customer.email,
        subject: `${SHOP_NAME} · קיבלנו את ההזמנה שלך (${o.no})`,
        htmlBody: customerEmail_(o, address),
        name: SHOP_NAME,
        inlineImages: { orelogo: logo_() },
        replyTo: OWNER_EMAIL
      });
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- helpers ---------- */

function sheet_() {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (sh) {
    if (sh.getLastColumn() < HEADERS.length) { // older sheet: add the new header cells
      sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#1d1b19').setFontColor('#ffffff');
    }
    return sh;
  }
  sh = ss.insertSheet(SHEET_NAME, 0);
  sh.setRightToLeft(true);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#1d1b19').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidths(1, HEADERS.length, 130);
  sh.setColumnWidth(7, 280);
  const statusCol = sh.getRange('C2:C');
  statusCol.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
  const colors = { 'חדשה': '#fde9c8', 'ממתינה לתשלום': '#fbd9d0', 'שולם': '#d7ecd9', 'בהכנה': '#dfe8f6', 'נשלחה': '#e9e2f5', 'נמסרה': '#e7e7e7', 'בוטלה': '#f2f2f2' };
  sh.setConditionalFormatRules(Object.keys(colors).map(s =>
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(colors[s]).setRanges([statusCol]).build()));
  sh.getRange('A2:A').setNumberFormat('dd/MM/yyyy HH:mm');
  sh.getRange('H2:M').setNumberFormat('₪#,##0.00');
  return sh;
}

/** Accept only the fields we expect, as short plain text. */
function clean_(o) {
  const txt = (v, n) => String(v == null ? '' : v).slice(0, n || 200);
  const num = v => Math.max(0, Math.min(100000, Number(v) || 0));
  const c = o.customer || {};
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 50).map(i => ({
    id: txt(i.id, 40), size: txt(i.size, 40), name: txt(i.name, 80), options: txt(i.options, 120), qty: Math.max(1, Math.min(99, Math.round(num(i.qty)))), price: num(i.price), total: num(i.total)
  }));
  if (!items.length || !txt(c.name) || !txt(c.phone)) throw new Error('הזמנה חסרה');
  return {
    no: txt(o.no, 30), date: txt(o.date, 40), items: items,
    subtotal: num(o.subtotal), discount: num(o.discount), coupon: txt(o.coupon, 30),
    shipping: txt(o.shipping, 60), shippingCost: num(o.shippingCost), total: num(o.total), payment: txt(o.payment, 40),
    customer: { name: txt(c.name, 80), phone: txt(c.phone, 30), email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email || '') ? txt(c.email, 120) : '',
      street: txt(c.street, 120), city: txt(c.city, 60), apt: txt(c.apt, 40) },
    needsAddress: !!o.needsAddress, gift: txt(o.gift, 300), notes: txt(o.notes, 400)
  };
}

function logo_() { return Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/jpeg', 'ore-logo.jpg'); }

/** Text that starts like a formula (= + - @) is stored as plain text. */
function safe_(v) { const s = String(v == null ? '' : v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }

/** Simple counter with an expiry: false once `max` is reached. */
function allow_(key, max, seconds) {
  const c = CacheService.getScriptCache();
  const n = Number(c.get(key) || 0);
  if (n >= max) return false;
  c.put(key, String(n + 1), seconds);
  return true;
}

function seen_(no) {
  const c = CacheService.getScriptCache();
  if (c.get('order:' + no)) return true;
  c.put('order:' + no, '1', 1800);
  return false;
}

/** Do the sums add up? And, when SITE_URL is set, do prices match the live site? */
function verify_(o) {
  const issues = [];
  const near = (a, b) => Math.abs(a - b) < 0.02;
  o.items.forEach(i => { if (!near(i.price * i.qty, i.total)) issues.push(`שורת ${i.name} לא מסתכמת`); });
  const sum = o.items.reduce((s, i) => s + i.price * i.qty, 0);
  if (!near(sum, o.subtotal)) issues.push('סכום הביניים לא תואם את המוצרים');
  if (!near(o.subtotal - o.discount + o.shippingCost, o.total)) issues.push('הסה"כ לא תואם');
  if (SITE_URL) {
    try {
      const c = CacheService.getScriptCache();
      let list = c.get('catalogue');
      if (!list) {
        list = UrlFetchApp.fetch(SITE_URL.replace(/\/$/, '') + '/data/products.json', { muteHttpExceptions: true }).getContentText();
        c.put('catalogue', list, 600);
      }
      const products = JSON.parse(list).products || [];
      o.items.forEach(i => {
        const p = products.find(x => x.id === i.id);
        if (!p) { issues.push(`${i.name}: לא נמצא באתר`); return; }
        const s = (p.sizes || []).find(x => x.label === i.size);
        const real = s ? s.price : p.price;
        if (!near(real, i.price)) issues.push(`${i.name}: באתר ${money_(real)}, בהזמנה ${money_(i.price)}`);
      });
    } catch (err) {
      issues.push('לא הצלחתי לבדוק מחירים מול האתר');
    }
  }
  return issues;
}

function esc_(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function money_(n) { return '₪' + (Math.round(n * 100) / 100).toLocaleString('he-IL'); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function itemsTable_(o) {
  const rows = o.items.map(i => `<tr><td style="padding:10px 0;border-bottom:1px solid #e4ded5">${esc_(i.name)}${i.options ? `<br><span style="color:#67615a;font-size:13px">${esc_(i.options)}</span>` : ''}</td>
    <td style="padding:10px 8px;border-bottom:1px solid #e4ded5;text-align:center">× ${i.qty}</td>
    <td style="padding:10px 0;border-bottom:1px solid #e4ded5;text-align:left">${money_(i.total)}</td></tr>`).join('');
  const line = (label, value, bold) => `<tr><td colspan="2" style="padding:4px 0;${bold ? 'font-weight:600;font-size:16px' : 'color:#67615a'}">${label}</td><td style="padding:4px 0;text-align:left;${bold ? 'font-weight:600;font-size:16px' : ''}">${value}</td></tr>`;
  return `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${rows}
    ${line('סכום ביניים', money_(o.subtotal))}
    ${o.discount ? line('הנחה' + (o.coupon ? ' (' + esc_(o.coupon) + ')' : ''), '−' + money_(o.discount)) : ''}
    ${line('משלוח · ' + esc_(o.shipping), o.shippingCost ? money_(o.shippingCost) : 'חינם')}
    ${line('סה"כ', money_(o.total), true)}</table>`;
}

function frame_(title, inner) {
  return `<div dir="rtl" style="background:#fbf9f6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1d1b19">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:28px">
      <p style="margin:0 0 8px;text-align:center"><img src="cid:orelogo" width="72" height="72" alt="${SHOP_NAME}" style="display:inline-block;border-radius:50%;width:72px;height:72px"></p>
      <p style="margin:0 0 24px;text-align:center;color:#67615a;font-size:13px">נרות בטון בעבודת יד</p>
      <h1 style="font-size:20px;font-weight:normal;margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid #e4ded5">${title}</h1>
      ${inner}
    </div></div>`;
}

function ownerEmail_(o, address, issues) {
  const c = o.customer;
  const wa = 'https://wa.me/972' + c.phone.replace(/\D/g, '').replace(/^0/, '');
  const warn = issues && issues.length ? `<p style="margin:0 0 16px;background:#fbe3dc;color:#8f3b29;padding:12px;line-height:1.6"><strong>כדאי לבדוק לפני שמבקשים תשלום:</strong><br>${issues.map(esc_).join('<br>')}</p>` : '';
  return frame_(`הזמנה חדשה ${esc_(o.no)}`, `
    ${warn}${itemsTable_(o)}
    <h2 style="font-size:16px;margin:24px 0 8px">לקוחה</h2>
    <p style="margin:0;line-height:1.7">${esc_(c.name)}<br><a href="tel:${esc_(c.phone)}">${esc_(c.phone)}</a>${c.email ? '<br>' + esc_(c.email) : ''}${address ? '<br>' + esc_(address) : ''}</p>
    <p style="margin:12px 0 0">תשלום: ${esc_(o.payment)}</p>
    ${o.gift ? `<p style="margin:12px 0 0;background:#f1ece4;padding:10px">ברכה למתנה: ${esc_(o.gift)}</p>` : ''}
    ${o.notes ? `<p style="margin:12px 0 0">הערות: ${esc_(o.notes)}</p>` : ''}
    <p style="margin:24px 0 0"><a href="${wa}" style="display:inline-block;background:#1d1b19;color:#ffffff;padding:12px 20px;text-decoration:none">כתיבה ללקוחה בוואטסאפ</a></p>`);
}

function customerEmail_(o, address) {
  return frame_(`תודה, ${esc_(o.customer.name)}! קיבלנו את ההזמנה`, `
    <p style="margin:0 0 16px;line-height:1.7">מספר הזמנה: <strong>${esc_(o.no)}</strong><br>
    נבדוק את ההזמנה ונשלח לך בקשת תשלום ב${esc_(o.payment || 'ביט')}. אחרי התשלום נכין את ההזמנה ונעדכן כשהיא יוצאת.</p>
    ${itemsTable_(o)}
    ${address ? `<p style="margin:16px 0 0">כתובת למשלוח: ${esc_(address)}</p>` : ''}
    ${o.gift ? `<p style="margin:12px 0 0;background:#f1ece4;padding:10px">ברכה למתנה: ${esc_(o.gift)}</p>` : ''}
    <p style="margin:24px 0 0;color:#67615a;font-size:13px">שאלה? אפשר להשיב למייל הזה או לכתוב לנו בוואטסאפ ${WHATSAPP}.</p>`);
}
