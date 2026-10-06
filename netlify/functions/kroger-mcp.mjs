// Remote MCP server (Streamable HTTP, JSON responses) exposing Kroger stores,
// prices and cart to Claude. Reached at /mcp/<BCC_MCP_KEY>; any other key gets 404.
import { KrogerError, keyMatches, configured, findStores, searchPrices, addToCart, cartLinked } from '../kroger-lib.mjs';

export const config = { path: '/mcp/:key' };

const SERVER = { name: 'blaise-kroger', version: '1.0.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'find_stores',
    description: 'Find Kroger stores near a ZIP code. Returns each store\'s location_id, name and address.',
    inputSchema: { type: 'object', properties: { zip: { type: 'string', description: '5-digit ZIP code' }, radius_miles: { type: 'number', description: 'Search radius, default 15' } }, required: ['zip'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search_prices',
    description: 'Search Kroger products and return current regular and sale prices at up to 5 stores. Products are matched across stores by UPC.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Product to search, at least 3 letters' }, location_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5, description: 'Kroger location_id values from find_stores' }, limit: { type: 'number', description: 'Products per store, default 8, max 20' } }, required: ['query', 'location_ids'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'cart_status',
    description: 'Whether the owner\'s Kroger account is linked so items can be added to their Kroger cart.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add_to_cart',
    description: 'Add products (by UPC) to the owner\'s Kroger cart for pickup or delivery. Does not check out or pay; the owner checks out in the Kroger app.',
    inputSchema: { type: 'object', properties: { items: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: { upc: { type: 'string' }, quantity: { type: 'number' } }, required: ['upc'], additionalProperties: false } }, modality: { type: 'string', enum: ['PICKUP', 'DELIVERY'] } }, required: ['items'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

const json = (status, body, extra = {}) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function callTool(name, args, linkUrl) {
  switch (name) {
    case 'find_stores': return { stores: await findStores({ zip: args.zip, radiusMiles: args.radius_miles }) };
    case 'search_prices': return searchPrices({ query: args.query, locationIds: args.location_ids, limit: args.limit });
    case 'cart_status': { const s = await cartLinked(); return s.linked ? s : { ...s, link_url: linkUrl }; }
    case 'add_to_cart': return addToCart({ items: args.items, modality: args.modality });
    default: throw new KrogerError(`Unknown tool: ${name}`, 400, 'bad_input');
  }
}

async function handle(msg, linkUrl) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg && msg.id, -32600, 'Invalid request');
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined || id === null;
  if (method.startsWith('notifications/')) return null;
  if (method === 'initialize') {
    const asked = params.protocolVersion;
    return rpcResult(id, { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: 'Kroger stores, live shelf prices and cart for Blaise Culinary Creations.' });
  }
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = params.name, args = params.arguments || {};
    if (!TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
    try {
      const data = await callTool(name, args, linkUrl);
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
    } catch (e) {
      const known = e instanceof KrogerError;
      if (!known) console.error('[kroger-mcp] unexpected', e && e.stack ? e.stack : e);
      const payload = { error: known ? e.code : 'internal_error', message: known ? e.message : 'Something went wrong.' };
      if (known && e.code === 'not_linked') payload.link_url = linkUrl;
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload, isError: true });
    }
  }
  return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`);
}

export default async (req, context) => {
  const key = context.params && context.params.key;
  if (!keyMatches(key)) return new Response('Not found', { status: 404 });
  if (req.method === 'GET' || req.method === 'DELETE') return json(405, { error: 'Use POST' }, { Allow: 'POST' });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
  if (!configured()) console.error('[kroger-mcp] Kroger keys missing');

  let body;
  try {
    const raw = await req.text();
    if (raw.length > 64 * 1024) return json(413, rpcError(null, -32600, 'Request too large'));
    body = JSON.parse(raw);
  } catch { return json(400, rpcError(null, -32700, 'Parse error')); }

  const linkUrl = `${new URL(req.url).origin.replace(/^http:/, 'https:')}/kroger/login?key=${encodeURIComponent(key)}`;
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, linkUrl)))).filter(Boolean);
    return out.length ? json(200, out) : new Response(null, { status: 202 });
  }
  const out = await handle(body, linkUrl);
  return out ? json(200, out) : new Response(null, { status: 202 });
};
