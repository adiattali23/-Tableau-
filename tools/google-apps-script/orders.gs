/**
 * ORÉ — order inbox (Google Apps Script)
 *
 * Every order placed on the site arrives here. The script:
 *   1. adds a row to the "הזמנות" sheet (with a status dropdown you update),
 *   2. emails you the full order,
 *   3. emails the customer an order confirmation (when she gave an email).
 *
 * Setup steps (in Hebrew) are in docs/orders-setup.md.
 * The only line you need to edit is OWNER_EMAIL below.
 */

const OWNER_EMAIL = 'PUT-YOUR-BUSINESS-EMAIL@gmail.com';
const SHOP_NAME = 'ORÉ';
const WHATSAPP = '052-254-3585';
const SHEET_NAME = 'הזמנות';
const STATUSES = ['חדשה', 'ממתינה לתשלום', 'שולם', 'בהכנה', 'נשלחה', 'נמסרה', 'בוטלה'];
const HEADERS = ['תאריך', 'מספר הזמנה', 'סטטוס', 'שם', 'טלפון', 'מייל', 'מוצרים', 'סכום ביניים', 'הנחה', 'קופון',
  'משלוח', 'עלות משלוח', 'סה"כ', 'תשלום', 'כתובת', 'ברכה למתנה', 'הערות'];

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
    const o = clean_(JSON.parse(e.postData.contents));
    const sh = sheet_();
    const address = o.needsAddress ? [o.customer.street, o.customer.apt, o.customer.city].filter(String).join(', ') : '';
    sh.appendRow([
      new Date(o.date || Date.now()), o.no, STATUSES[0], o.customer.name, "'" + o.customer.phone, o.customer.email,
      o.items.map(i => `${i.name}${i.options ? ' (' + i.options + ')' : ''} × ${i.qty}`).join('\n'),
      o.subtotal, o.discount, o.coupon, o.shipping, o.shippingCost, o.total, o.payment, address, o.gift, o.notes
    ]);

    MailApp.sendEmail({
      to: OWNER_EMAIL,
      subject: `הזמנה חדשה ${o.no} · ${money_(o.total)} · ${o.customer.name}`,
      htmlBody: ownerEmail_(o, address),
      name: SHOP_NAME + ' – הזמנות',
      replyTo: o.customer.email || OWNER_EMAIL
    });
    if (o.customer.email) {
      MailApp.sendEmail({
        to: o.customer.email,
        subject: `${SHOP_NAME} · קיבלנו את ההזמנה שלך (${o.no})`,
        htmlBody: customerEmail_(o, address),
        name: SHOP_NAME,
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (sh) return sh;
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
    name: txt(i.name, 80), options: txt(i.options, 120), qty: Math.max(1, Math.min(99, Math.round(num(i.qty)))), price: num(i.price), total: num(i.total)
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
      <p style="margin:0 0 4px;font-size:22px;letter-spacing:4px;text-align:center">${SHOP_NAME}</p>
      <p style="margin:0 0 24px;text-align:center;color:#67615a;font-size:13px">נרות בטון בעבודת יד</p>
      <h1 style="font-size:20px;font-weight:normal;margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid #e4ded5">${title}</h1>
      ${inner}
    </div></div>`;
}

function ownerEmail_(o, address) {
  const c = o.customer;
  const wa = 'https://wa.me/972' + c.phone.replace(/\D/g, '').replace(/^0/, '');
  return frame_(`הזמנה חדשה ${esc_(o.no)}`, `
    ${itemsTable_(o)}
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
