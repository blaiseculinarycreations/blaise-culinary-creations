// Shared Kroger API helpers for the Blaise Culinary Creations functions.
// Env (Netlify, Functions scope): KROGER_CLIENT_ID, KROGER_CLIENT_SECRET, BCC_MCP_KEY
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

export const API = 'https://api.kroger.com/v1';
export const REDIRECT_URI = 'https://blaiseculinarycreations.netlify.app/kroger/callback';
const TIMEOUT_MS = 8000;

export class KrogerError extends Error {
  constructor(message, status = 502, code = 'kroger_error') { super(message); this.status = status; this.code = code; }
}

export function configured() {
  return Boolean(process.env.KROGER_CLIENT_ID && process.env.KROGER_CLIENT_SECRET);
}

// Constant-time comparison for the shared connector key.
export function keyMatches(given) {
  const want = process.env.BCC_MCP_KEY || '';
  if (!want || typeof given !== 'string' || given.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

const store = () => getStore({ name: 'kroger', consistency: 'strong' });

async function kfetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    throw new KrogerError(e.name === 'AbortError' ? 'Kroger took too long to answer.' : 'Could not reach Kroger.', 504, 'unavailable');
  } finally { clearTimeout(t); }
}

async function tokenRequest(params) {
  if (!configured()) throw new KrogerError('Kroger keys are not set on the site.', 503, 'not_configured');
  const basic = Buffer.from(`${process.env.KROGER_CLIENT_ID}:${process.env.KROGER_CLIENT_SECRET}`).toString('base64');
  const res = await kfetch(`${API}/connect/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('[kroger] token error', res.status, text.slice(0, 300));
    if (res.status === 400 || res.status === 401) throw new KrogerError('Kroger rejected the sign-in. Check the Kroger keys on the site.', 502, 'auth_failed');
    throw new KrogerError('Kroger sign-in failed. Try again.', 502);
  }
  return JSON.parse(text);
}

// App token for prices and stores (no customer account involved).
let appToken = null;
async function getAppToken() {
  if (appToken && appToken.exp > Date.now() + 60000) return appToken.value;
  const t = await tokenRequest({ grant_type: 'client_credentials', scope: 'product.compact' });
  appToken = { value: t.access_token, exp: Date.now() + (t.expires_in || 1800) * 1000 };
  return appToken.value;
}

async function apiGet(path, params) {
  const token = await getAppToken();
  const res = await kfetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    console.error('[kroger] GET', path, res.status, text.slice(0, 300));
    if (res.status === 401) appToken = null;
    if (res.status === 429) throw new KrogerError('Kroger daily lookup limit reached. Try again later.', 429, 'rate_limited');
    throw new KrogerError('Kroger could not answer that lookup.', 502);
  }
  return JSON.parse(text);
}

// ---------- stores ----------
export async function findStores({ zip, radiusMiles = 15, limit = 10 }) {
  if (!/^\d{5}$/.test(String(zip || ''))) throw new KrogerError('Give a 5-digit ZIP code.', 400, 'bad_input');
  const r = await apiGet('/locations', {
    'filter.zipCode.near': String(zip),
    'filter.radiusInMiles': String(Math.min(Math.max(Number(radiusMiles) || 15, 1), 100)),
    'filter.limit': String(Math.min(Math.max(Number(limit) || 10, 1), 20)),
    'filter.chain': 'KROGER',
  });
  return (r.data || []).map((l) => ({
    location_id: l.locationId,
    name: l.name,
    address: [l.address?.addressLine1, l.address?.city, l.address?.state, l.address?.zipCode].filter(Boolean).join(', '),
  }));
}

// ---------- prices ----------
const LOC_RE = /^[0-9A-Za-z]{8}$/;
export async function searchPrices({ query, locationIds, limit = 8 }) {
  const term = String(query || '').trim().slice(0, 60);
  if (term.length < 3) throw new KrogerError('Search needs at least 3 letters.', 400, 'bad_input');
  const locs = [...new Set((locationIds || []).map(String))].filter((x) => LOC_RE.test(x)).slice(0, 5);
  if (!locs.length) throw new KrogerError('Pick at least one Kroger store.', 400, 'bad_input');
  const lim = String(Math.min(Math.max(Number(limit) || 8, 1), 20));

  const results = await Promise.allSettled(locs.map((loc) => apiGet('/products', { 'filter.term': term, 'filter.locationId': loc, 'filter.limit': lim })));
  const byUpc = new Map();
  const failed = [];
  results.forEach((res, i) => {
    const loc = locs[i];
    if (res.status !== 'fulfilled') { failed.push(loc); return; }
    for (const p of res.value.data || []) {
      const item = (p.items || [])[0] || {};
      const key = p.upc || p.productId;
      if (!key) continue;
      if (!byUpc.has(key)) {
        byUpc.set(key, { upc: p.upc || '', product_id: p.productId || '', description: p.description || '', brand: p.brand || '', size: item.size || '', sold_by: item.soldBy || '', prices: [] });
      }
      const price = item.price || {};
      byUpc.get(key).prices.push({
        location_id: loc,
        regular: typeof price.regular === 'number' && price.regular > 0 ? price.regular : null,
        promo: typeof price.promo === 'number' && price.promo > 0 ? price.promo : null,
        stock: item.inventory?.stockLevel || null,
        aisle: (p.aisleLocations || [])[0]?.description || null,
      });
    }
  });
  if (failed.length === locs.length) throw new KrogerError('Kroger could not answer for any of those stores.', 502);
  return { query: term, stores: locs, failed_stores: failed, products: [...byUpc.values()] };
}

// ---------- customer cart (one-time sign-in) ----------
export function authorizeUrl(state) {
  const q = new URLSearchParams({ scope: 'cart.basic:write', response_type: 'code', client_id: process.env.KROGER_CLIENT_ID || '', redirect_uri: REDIRECT_URI, state });
  return `${API}/connect/oauth2/authorize?${q}`;
}

export async function saveUserTokens(t) {
  await store().setJSON('user', { refresh_token: t.refresh_token, access_token: t.access_token, exp: Date.now() + (t.expires_in || 1800) * 1000, linked_at: new Date().toISOString() });
}

export async function exchangeCode(code) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
  await saveUserTokens(t);
}

export async function cartLinked() {
  const u = await store().get('user', { type: 'json' });
  return u && u.refresh_token ? { linked: true, linked_at: u.linked_at } : { linked: false };
}

async function getUserToken() {
  const u = await store().get('user', { type: 'json' });
  if (!u || !u.refresh_token) throw new KrogerError('Your Kroger account is not linked yet.', 409, 'not_linked');
  if (u.access_token && u.exp > Date.now() + 60000) return u.access_token;
  let t;
  try {
    t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: u.refresh_token });
  } catch (e) {
    if (e.code === 'auth_failed') { await store().delete('user'); throw new KrogerError('Your Kroger link expired. Link your Kroger account again.', 409, 'not_linked'); }
    throw e;
  }
  await saveUserTokens({ refresh_token: t.refresh_token || u.refresh_token, access_token: t.access_token, expires_in: t.expires_in });
  return t.access_token;
}

export async function addToCart({ items, modality = 'PICKUP' }) {
  const mode = modality === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
  const clean = (items || []).slice(0, 50).map((it) => ({ upc: String(it.upc || ''), quantity: Math.min(Math.max(parseInt(it.quantity, 10) || 1, 1), 50), modality: mode }))
    .filter((it) => /^\d{8,14}$/.test(it.upc));
  if (!clean.length) throw new KrogerError('No valid items to add.', 400, 'bad_input');
  const token = await getUserToken();
  const res = await kfetch(`${API}/cart/add`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items: clean }) });
  if (!res.ok) {
    const text = await res.text();
    console.error('[kroger] cart add', res.status, text.slice(0, 300));
    if (res.status === 401 || res.status === 403) throw new KrogerError('Kroger refused the cart update. Link your Kroger account again.', 409, 'not_linked');
    throw new KrogerError('Kroger could not add those items. Try again.', 502);
  }
  return { added: clean.length, modality: mode };
}
