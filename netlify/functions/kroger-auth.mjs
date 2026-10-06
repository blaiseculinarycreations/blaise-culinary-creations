// One-time Kroger account link so the dashboard can fill the owner's Kroger cart.
//   /kroger/login?key=<BCC_MCP_KEY>  -> sends the owner to Kroger's sign-in
//   /kroger/callback                 -> Kroger returns here; tokens are stored server-side
import crypto from 'node:crypto';
import { keyMatches, configured, authorizeUrl, exchangeCode, KrogerError } from '../kroger-lib.mjs';

export const config = { path: ['/kroger/login', '/kroger/callback'] };

const page = (status, title, msg) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;background:#0d0d0e;color:#d6d7d9;font:16px/1.5 "Helvetica Neue",Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}main{max-width:28rem;text-align:center}h1{color:#f1f1f2;font-size:1.3rem}</style></head>
<body><main><h1>${title}</h1><p>${msg}</p></main></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } });

const COOKIE = 'kroger_state';

export default async (req) => {
  const url = new URL(req.url);
  if (!configured()) return page(503, 'Kroger isn’t set up', 'The Kroger keys aren’t on the site yet.');

  if (url.pathname === '/kroger/login') {
    if (!keyMatches(url.searchParams.get('key'))) return page(404, 'Not found', 'This link isn’t valid.');
    const state = crypto.randomBytes(24).toString('base64url');
    return new Response(null, { status: 302, headers: {
      Location: authorizeUrl(state),
      'Set-Cookie': `${COOKIE}=${state}; Path=/kroger; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      'Cache-Control': 'no-store',
    } });
  }

  // callback
  const clear = `${COOKIE}=; Path=/kroger; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  const cookie = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  const want = cookie ? cookie.slice(COOKIE.length + 1) : '';
  const got = url.searchParams.get('state') || '';
  if (url.searchParams.get('error')) {
    const r = page(400, 'Kroger link cancelled', 'Nothing was changed. You can close this tab.'); r.headers.append('Set-Cookie', clear); return r;
  }
  if (!want || want.length !== got.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got))) {
    return page(400, 'Link expired', 'Start again from the dashboard’s “Link Kroger” button.');
  }
  const code = url.searchParams.get('code');
  if (!code) return page(400, 'Missing code', 'Start again from the dashboard’s “Link Kroger” button.');
  try {
    await exchangeCode(code);
  } catch (e) {
    console.error('[kroger-auth]', e && e.message);
    const r = page(502, 'Kroger link failed', e instanceof KrogerError ? e.message : 'Something went wrong. Try again.'); r.headers.append('Set-Cookie', clear); return r;
  }
  const r = page(200, 'Kroger linked', 'Your dashboard can now add items to your Kroger cart. You check out in the Kroger app. You can close this tab.');
  r.headers.append('Set-Cookie', clear);
  return r;
};
