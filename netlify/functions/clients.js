// Netlify Function: /.netlify/functions/clients
// Private client records for the Blaise Culinary Creations dashboard.
//
// Every request must carry a Netlify Identity JWT:  Authorization: Bearer <token>
// Netlify verifies the token's signature with the site's Identity secret before
// this code runs and exposes the verified user as context.clientContext.user.
// A missing, forged or expired token leaves that empty, and we return 401.
// A valid token from someone who is not on ADMIN_EMAILS gets 403.
//
// Environment variables (Netlify -> Site configuration -> Environment variables,
// scope: Functions, mark the key as secret):
//   SUPABASE_URL               https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role key (or new sb_secret_... key)
//   ADMIN_EMAILS               comma-separated list, e.g. blaiseculinarycreations@gmail.com
//
// No npm dependencies: talks to Supabase's REST API with Node's built-in fetch.

'use strict';

const TABLE = 'clients';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SELECT_COLS = 'id,full_name,phone,email,address_line1,address_line2,city,state,postal_code,dietary_notes,created_at,updated_at';
const DB_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 16 * 1024;

// ---------- responses ----------
const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function reply(statusCode, payload, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({}, BASE_HEADERS, extraHeaders || {}),
    body: payload === undefined ? '' : JSON.stringify(payload),
  };
}
const fail = (status, message, extra) => reply(status, { error: message }, extra);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- auth ----------
function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function requireAdmin(event, context) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  if (!/^Bearer\s+\S+$/i.test(header)) {
    throw new HttpError(401, 'Unauthorized');
  }
  // Populated only when Netlify has verified the JWT signature.
  const user = context && context.clientContext && context.clientContext.user;
  if (!user || !user.email) {
    throw new HttpError(401, 'Unauthorized');
  }
  // Defence in depth: reject expired tokens even if they reach us.
  if (typeof user.exp === 'number' && user.exp * 1000 <= Date.now()) {
    throw new HttpError(401, 'Unauthorized');
  }
  const allowed = adminEmails();
  if (!allowed.length) {
    // Fail closed: if the allow-list is not configured, nobody gets in.
    console.error('[clients] ADMIN_EMAILS is not set; refusing all requests');
    throw new HttpError(503, 'Service not configured');
  }
  if (!allowed.includes(String(user.email).toLowerCase())) {
    throw new HttpError(403, 'Forbidden');
  }
  return user;
}

// ---------- validation ----------
const clean = (v) => (typeof v === 'string' ? v.trim() : v);

const FIELDS = {
  full_name(v) {
    v = clean(v);
    if (typeof v !== 'string' || v.length < 1 || v.length > 120) throw new HttpError(400, 'Name is required (1-120 characters).');
    return v;
  },
  phone(v) {
    v = clean(v);
    if (v === null || v === '' || v === undefined) return null;
    if (typeof v !== 'string') throw new HttpError(400, 'Phone must be text.');
    let digits = v.replace(/[^\d+]/g, '');
    if (/^\d{10}$/.test(digits)) digits = '+1' + digits;           // US number without country code
    else if (/^1\d{10}$/.test(digits)) digits = '+' + digits;
    if (!/^\+?\d{10,15}$/.test(digits)) throw new HttpError(400, 'Phone number looks invalid.');
    return digits;
  },
  email(v) {
    v = clean(v);
    if (v === null || v === '' || v === undefined) return null;
    if (typeof v !== 'string' || v.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new HttpError(400, 'Email looks invalid.');
    return v.toLowerCase();
  },
  address_line1: (v) => optText(v, 200, 'Address line 1'),
  address_line2: (v) => optText(v, 200, 'Address line 2'),
  city: (v) => optText(v, 100, 'City'),
  state(v) {
    v = clean(v);
    if (v === null || v === '' || v === undefined) return null;
    v = String(v).toUpperCase();
    if (!/^[A-Z]{2}$/.test(v)) throw new HttpError(400, 'State must be a 2-letter code, e.g. GA.');
    return v;
  },
  postal_code(v) {
    v = clean(v);
    if (v === null || v === '' || v === undefined) return null;
    if (!/^\d{5}(-\d{4})?$/.test(String(v))) throw new HttpError(400, 'ZIP code looks invalid.');
    return String(v);
  },
  dietary_notes: (v) => optText(v, 4000, 'Dietary notes'),
};

function optText(v, max, label) {
  v = clean(v);
  if (v === null || v === '' || v === undefined) return null;
  if (typeof v !== 'string') throw new HttpError(400, `${label} must be text.`);
  if (v.length > max) throw new HttpError(400, `${label} is too long (max ${max}).`);
  return v;
}

function parseBody(event) {
  if (!event.body) throw new HttpError(400, 'Request body is required.');
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large.');
  let data;
  try { data = JSON.parse(raw); } catch { throw new HttpError(400, 'Body must be valid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Body must be a JSON object.');
  return data;
}

// partial=true for PATCH (only provided fields), false for POST (name required)
function validateClient(data, partial) {
  const unknown = Object.keys(data).filter((k) => !(k in FIELDS));
  if (unknown.length) throw new HttpError(400, `Unknown field(s): ${unknown.join(', ')}`);
  const out = {};
  for (const key of Object.keys(FIELDS)) {
    if (key in data) out[key] = FIELDS[key](data[key]);
    else if (!partial && key === 'full_name') FIELDS.full_name(undefined); // throws "Name is required"
  }
  if (partial && !Object.keys(out).length) throw new HttpError(400, 'Nothing to update.');
  return out;
}

function requireId(params) {
  const id = params && params.id;
  if (!id || !UUID_RE.test(id)) throw new HttpError(400, 'A valid client id is required.');
  return id;
}

// ---------- Supabase REST ----------
function dbConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!/^https:\/\/[^/]+$/.test(url) || !key) {
    console.error('[clients] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing or malformed');
    throw new HttpError(503, 'Service not configured');
  }
  return { url, key };
}

async function db(method, query, body, extraHeaders) {
  const { url, key } = dbConfig();
  const headers = Object.assign({ apikey: key, Accept: 'application/json' }, extraHeaders || {});
  // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys must not.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DB_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${url}/rest/v1/${TABLE}${query}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    console.error('[clients] database request failed:', err && err.name);
    throw new HttpError(err && err.name === 'AbortError' ? 504 : 502, 'Database unavailable, try again.');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    // Log details server-side only; never send database errors to the browser.
    console.error('[clients] database error', res.status, text.slice(0, 500));
    if (res.status === 400 || res.status === 422) throw new HttpError(400, 'The database rejected that data. Check the fields and try again.');
    if (res.status === 409) throw new HttpError(409, 'That record conflicts with an existing one.');
    throw new HttpError(502, 'Database error, try again.');
  }
  return { data: text ? JSON.parse(text) : null, headers: res.headers };
}

// ---------- handlers ----------
async function listClients(params) {
  const limit = Math.min(Math.max(parseInt(params.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(params.offset, 10) || 0, 0);
  let q = `?select=${SELECT_COLS}&order=full_name.asc&limit=${limit}&offset=${offset}`;

  if (params.id) {
    q = `?select=${SELECT_COLS}&id=eq.${requireId(params)}`;
    const { data } = await db('GET', q);
    if (!data || !data.length) throw new HttpError(404, 'Client not found.');
    return reply(200, { client: data[0] });
  }

  if (params.q) {
    // Allow only safe characters so the value can't alter the filter syntax.
    const term = String(params.q).replace(/[^\p{L}\p{N} @.+'-]/gu, '').trim().slice(0, 60);
    if (term) {
      const like = encodeURIComponent(`*${term}*`);
      q += `&or=(full_name.ilike.${like},email.ilike.${like},phone.ilike.${like})`;
    }
  }
  const { data, headers } = await db('GET', q, undefined, { Prefer: 'count=exact' });
  const range = headers.get('content-range') || '';          // e.g. 0-24/25
  const total = parseInt(range.split('/')[1], 10);
  return reply(200, { clients: data || [], total: Number.isFinite(total) ? total : null, limit, offset });
}

async function createClient(event) {
  const row = validateClient(parseBody(event), false);
  const { data } = await db('POST', `?select=${SELECT_COLS}`, row, { Prefer: 'return=representation' });
  return reply(201, { client: data[0] });
}

async function updateClient(event, params) {
  const id = requireId(params);
  const row = validateClient(parseBody(event), true);
  const { data } = await db('PATCH', `?id=eq.${id}&select=${SELECT_COLS}`, row, { Prefer: 'return=representation' });
  if (!data || !data.length) throw new HttpError(404, 'Client not found.');
  return reply(200, { client: data[0] });
}

async function deleteClient(params) {
  const id = requireId(params);
  const { data } = await db('DELETE', `?id=eq.${id}&select=id`, undefined, { Prefer: 'return=representation' });
  if (!data || !data.length) throw new HttpError(404, 'Client not found.');
  return reply(200, { deleted: id });
}

exports.handler = async (event, context) => {
  try {
    const method = event.httpMethod;
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
      return fail(405, 'Method not allowed', { Allow: 'GET, POST, PATCH, DELETE' });
    }

    // 1. Authenticate and authorise BEFORE touching the database.
    const user = requireAdmin(event, context);

    // 2. Run the query.
    const params = event.queryStringParameters || {};
    let res;
    if (method === 'GET') res = await listClients(params);
    else if (method === 'POST') res = await createClient(event);
    else if (method === 'PATCH') res = await updateClient(event, params);
    else res = await deleteClient(params);

    if (method !== 'GET') console.log(`[clients] ${method} by ${user.email} -> ${res.statusCode}`);
    return res;
  } catch (err) {
    if (err instanceof HttpError) {
      const extra = err.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : undefined;
      return fail(err.status, err.message, extra);
    }
    console.error('[clients] unexpected error:', err && err.stack ? err.stack : err);
    return fail(500, 'Something went wrong.');
  }
};
