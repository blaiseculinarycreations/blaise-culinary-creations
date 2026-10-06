// Blaise Culinary Creations: authenticated calls to the clients function.
// Requires the Netlify Identity widget loaded first:
//   <script src="https://identity.netlify.com/v1/netlify-identity-widget.js"></script>
//
// Usage:
//   const { clients } = await ClientsAPI.list({ q: 'smith' });
//   await ClientsAPI.create({ full_name: 'Jane Doe', phone: '6315550100' });
//   await ClientsAPI.update(id, { dietary_notes: 'No shellfish' });
//   await ClientsAPI.remove(id);

(function () {
  'use strict';

  var ENDPOINT = '/.netlify/functions/clients';
  var TIMEOUT_MS = 15000;

  function AuthError(message) { this.name = 'AuthError'; this.message = message || 'Please sign in.'; }
  AuthError.prototype = Object.create(Error.prototype);

  function ApiError(status, message) { this.name = 'ApiError'; this.status = status; this.message = message; }
  ApiError.prototype = Object.create(Error.prototype);

  // Wait until the widget has restored any saved session from the last visit.
  var ready = new Promise(function (resolve) {
    if (!window.netlifyIdentity) { resolve(); return; }
    window.netlifyIdentity.on('init', function () { resolve(); });
    // If init already fired before this script ran, don't hang.
    setTimeout(resolve, 3000);
  });

  // Returns the current user's access token. user.jwt() refreshes it
  // automatically when it has expired (tokens last about an hour).
  async function getToken(forceRefresh) {
    await ready;
    var id = window.netlifyIdentity;
    if (!id) throw new AuthError('Sign-in is unavailable. Reload the page.');
    var user = id.currentUser();
    if (!user) throw new AuthError();
    try {
      return await user.jwt(!!forceRefresh);
    } catch (e) {
      // Refresh token revoked or expired: the session is no longer valid.
      throw new AuthError('Your session expired. Please sign in again.');
    }
  }

  async function request(method, params, body, retried) {
    var token = await getToken(retried);
    var qs = params ? '?' + new URLSearchParams(params).toString() : '';
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    var res;
    try {
      res = await fetch(ENDPOINT + qs, {
        method: method,
        headers: Object.assign(
          { Authorization: 'Bearer ' + token, Accept: 'application/json' },
          body !== undefined ? { 'Content-Type': 'application/json' } : {}
        ),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: ctrl.signal
      });
    } catch (e) {
      throw new ApiError(0, e && e.name === 'AbortError' ? 'The request timed out. Try again.' : 'Network error. Check your connection.');
    } finally {
      clearTimeout(timer);
    }

    // Token rejected: refresh once and retry, then ask the user to sign in.
    if (res.status === 401) {
      if (!retried) return request(method, params, body, true);
      throw new AuthError('Your session expired. Please sign in again.');
    }

    var data = null;
    try { data = await res.json(); } catch (e) { /* empty or non-JSON body */ }
    if (!res.ok) {
      if (res.status === 403) throw new ApiError(403, 'This account is not allowed to see client records.');
      throw new ApiError(res.status, (data && data.error) || 'Request failed (' + res.status + ').');
    }
    return data;
  }

  window.ClientsAPI = {
    AuthError: AuthError,
    ApiError: ApiError,
    getToken: getToken,
    list: function (opts) {                     // opts: { q, limit, offset }
      var p = {};
      if (opts && opts.q) p.q = opts.q;
      if (opts && opts.limit) p.limit = String(opts.limit);
      if (opts && opts.offset) p.offset = String(opts.offset);
      return request('GET', p);
    },
    get: function (id) { return request('GET', { id: id }); },
    create: function (client) { return request('POST', null, client); },
    update: function (id, changes) { return request('PATCH', { id: id }, changes); },
    remove: function (id) { return request('DELETE', { id: id }); }
  };
})();
