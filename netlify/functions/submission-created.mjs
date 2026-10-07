// Instant confirmation emails for website form submissions.
// Netlify runs this automatically for every verified (non-spam) Netlify Forms submission.
//
// It does nothing until these environment variables are set (so it is safe to deploy early):
//   CONFIRM_EMAILS      = on
//   RESEND_API_KEY      = API key from resend.com (domain verified there)
//   CONFIRM_FROM        = Blaise Culinary Creations <hello@yourdomain.com>
//   CONFIRM_REPLY_TO    = blaiseculinarycreations@gmail.com   (optional, defaults to this)
//   CONFIRM_BCC         = blaiseculinarycreations@gmail.com   (optional: get a copy of each email)

const SITE = 'https://blaiseculinarycreations.netlify.app';
const PHONE = '(631) 710-1226';
const DEFAULT_REPLY = 'blaiseculinarycreations@gmail.com';
const DINNERS = ['Private Dinner Party', 'Romantic Dinner', "Chef's Table", 'Wine Pairing'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, max = 200) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const validEmail = (e) => /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/.test(e) && e.length <= 254;

function fmtDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
}
function fmtTime(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(t || ''); if (!m) return '';
  const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#0d0d0e;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#d6d7d9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#151517;border:1px solid #2a2a2d" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 28px 8px;font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#8a8b8f">Blaise Culinary Creations</td></tr>
<tr><td style="padding:0 28px 8px;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#f1f1f2">${esc(title)}</td></tr>
<tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #2a2a2d;font-size:12px;color:#8a8b8f">Chef Clauvys Blaise · Dacula, Georgia · ${PHONE}<br><a href="${SITE}" style="color:#c9cacc">${SITE.replace('https://', '')}</a></td></tr>
</table></td></tr></table></body></html>`;
}

function bookingEmail(d) {
  const first = clean(d.name, 80).split(' ')[0] || 'there';
  const parts = clean(d.service, 160).split('|').map((x) => x.trim()).filter(Boolean);
  const service = parts[0] || 'your event', tier = parts[1] || '', price = parts[2] || '';
  const date = fmtDate(d.date), guests = clean(d.guests, 10), city = clean(d.city, 80);
  const call = clean(d.call, 40);
  const wantsCall = call && !/^no/i.test(call);
  const callWhen = [fmtDate(d.call_date), fmtTime(d.call_time)].filter(Boolean).join(' at ');
  const dinner = DINNERS.some((k) => service.includes(k));

  const rows = [
    ['Service', [service, tier].filter(Boolean).join(' · ')],
    ['Listed price', price ? `${price} (groceries billed at cost)` : ''],
    ['Date', date],
    ['Guests', guests],
    ['Area', city],
    ['Call', wantsCall ? `${call}${callWhen ? `, requested for ${callWhen}` : ''}` : ''],
  ].filter((r) => r[1]);

  const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;border-top:1px solid #2a2a2d">${rows.map(([k, v]) =>
    `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #2a2a2d;color:#8a8b8f;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #2a2a2d;color:#f1f1f2">${esc(v)}</td></tr>`).join('')}</table>`;

  const next = [
    'I’ll reply personally within 24 hours to talk through the menu and confirm availability.',
    wantsCall ? (call.includes('Meet') ? 'I’ll confirm your call time and send a Google Meet invite to this address.' : `I’ll confirm your call time and call you at the number you gave.`) : '',
    'A deposit holds your date; the balance and grocery estimate are due 4 days before the event.',
    dinner ? 'Dinners are best booked at least 14 days ahead so there’s time to plan and shop.' : '',
  ].filter(Boolean);

  const html = layout('Request received', `
<p style="margin:0 0 12px">Hi ${esc(first)},</p>
<p style="margin:0 0 12px">Thank you for reaching out. I’ve received your request, and here’s what you sent:</p>
${table}
<p style="margin:0 0 8px;color:#f1f1f2">What happens next</p>
<ul style="margin:0 0 16px;padding-left:18px">${next.map((n) => `<li style="margin-bottom:6px">${esc(n)}</li>`).join('')}</ul>
<p style="margin:0 0 12px">Please tell me about any allergies or dietary needs if you haven’t already. Just reply to this email.</p>
<p style="margin:0 0 4px">Full booking terms: <a href="${SITE}/terms/" style="color:#c9cacc">${SITE.replace('https://', '')}/terms/</a></p>
<p style="margin:16px 0 0">Chef Clauvys Blaise</p>`);

  const text = [`Hi ${first},`, '', 'Thank you for reaching out. I’ve received your request:', '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '', 'What happens next:', ...next.map((n) => `- ${n}`), '',
    'Please tell me about any allergies or dietary needs by replying to this email.', `Booking terms: ${SITE}/terms/`, '', 'Chef Clauvys Blaise', PHONE].join('\n');

  return { subject: `We received your request${date ? ` for ${date}` : ''} · Blaise Culinary Creations`, html, text };
}

function reviewEmail(d) {
  const first = clean(d.name, 80).split(' ')[0] || 'there';
  const html = layout('Thank you', `
<p style="margin:0 0 12px">Hi ${esc(first)},</p>
<p style="margin:0 0 12px">Thank you for taking the time to review your dinner. It means a lot, and it helps the next table decide.</p>
<p style="margin:0 0 12px">${d.publish === 'no' ? 'As you asked, your review stays private.' : 'Your review will appear on the site once I’ve confirmed it.'}</p>
<p style="margin:16px 0 0">Chef Clauvys Blaise</p>`);
  const text = `Hi ${first},\n\nThank you for taking the time to review your dinner. It means a lot.\n${d.publish === 'no' ? 'As you asked, your review stays private.' : 'Your review will appear on the site once I’ve confirmed it.'}\n\nChef Clauvys Blaise`;
  return { subject: 'Thank you for your review · Blaise Culinary Creations', html, text };
}

async function send({ to, subject, html, text }) {
  const body = { from: process.env.CONFIRM_FROM, to: [to], subject, html, text, reply_to: process.env.CONFIRM_REPLY_TO || DEFAULT_REPLY };
  if (process.env.CONFIRM_BCC && validEmail(process.env.CONFIRM_BCC)) body.bcc = [process.env.CONFIRM_BCC];
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error('[confirm] send failed', res.status, (await res.text()).slice(0, 300));
    else console.log('[confirm] sent', subject);
  } catch (e) {
    console.error('[confirm] send error', e && e.name);
  } finally { clearTimeout(t); }
}

export default async (req) => {
  // Off until the owner turns it on with a verified sending domain.
  if (process.env.CONFIRM_EMAILS !== 'on' || !process.env.RESEND_API_KEY || !process.env.CONFIRM_FROM) return new Response('skipped');
  let payload;
  try { payload = (await req.json()).payload; } catch { return new Response('bad payload', { status: 400 }); }
  const form = payload && (payload.form_name || (payload.data && payload.data['form-name']));
  const d = (payload && payload.data) || {};
  const to = clean(d.email, 254).toLowerCase();
  if (!validEmail(to)) return new Response('no valid email');
  if (d['bot-field']) return new Response('skipped');

  let msg = null;
  if (form === 'booking') msg = bookingEmail(d);
  else if (form === 'review') msg = reviewEmail(d);
  if (!msg) return new Response('no template');
  await send({ to, ...msg });
  return new Response('ok');
};
