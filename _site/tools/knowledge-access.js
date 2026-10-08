(function () {
  'use strict';
  if (!document.getElementById('knowledge-access')) return;
  var state = { user: null, epoch: 0, busy: false, approval: null };
  var description = $('description').textContent;
  function resetCopy() { $('description').textContent = description; $('heading').textContent = 'Approve knowledge connection'; $('approve').textContent = 'Approve read-only connection'; }
  var nonce = new URLSearchParams(window.location.search).get('mcp_request');
  if (!/^[a-f0-9]{32}$/.test(nonce || '')) nonce = null;
  function $(id) { return document.getElementById('ka-' + id); }
  function status(text) { $('status').textContent = text; }
  function controls() { $('approve').disabled = state.busy || !state.approval; $('cancel').disabled = state.busy; }
  async function call(data) {
    var epoch = state.epoch, service = await window.siteAuth.firebaseFunctions();
    if (epoch !== state.epoch || !state.user) throw new Error('Session changed.');
    var result = await service.httpsCallable('messageAgents', { timeout: 30000, limitedUseAppCheckTokens: true })(data);
    if (epoch !== state.epoch || !state.user) throw new Error('Session changed.');
    return result.data;
  }
  async function workerJson(path, options) {
    var controller = new AbortController(), timer = window.setTimeout(function () { controller.abort(); }, 15000);
    try {
      var response = await fetch('https://mcp.oliabak.com' + path, Object.assign({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal }, options || {}));
      if (new URL(response.url).origin !== 'https://mcp.oliabak.com' || !response.ok || Number(response.headers.get('content-length') || 0) > 8000 || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) throw new Error('Connection failed.');
      var reader = response.body.getReader(), chunks = [], size = 0;
      try { for (;;) { var part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 8000) throw new Error('Invalid response.'); chunks.push(part.value); } }
      catch (error) { await reader.cancel(); throw error; }
      finally { reader.releaseLock(); }
      var bytes = new Uint8Array(size), at = 0;
      chunks.forEach(function (chunk) { bytes.set(chunk, at); at += chunk.length; });
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally { window.clearTimeout(timer); }
  }
  async function load() {
    var epoch = state.epoch;
    resetCopy(); state.approval = null; $('consent').hidden = true; $('client').textContent = ''; controls();
    try {
      var permission = await call({ action: 'knowledge-status' });
      if (epoch !== state.epoch) return;
      if (permission.allowed !== true) { status('The site owner has not granted knowledge access to this account.'); return; }
      if (!nonce) { status('Your account has knowledge permission. Start a new knowledge connection from your assistant app. Retrieval requires the owner’s computer to be online.'); return; }
      var data = await workerJson('/approval-info?request=' + nonce);
      if (epoch !== state.epoch || !state.user) return;
      if (data.nonce !== nonce || typeof data.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.clientId) || typeof data.clientName !== 'string' || data.clientName.length > 100 || typeof data.redirectHost !== 'string' || data.redirectHost.length > 255 || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now() || !Array.isArray(data.scopes) || data.scopes.length !== 1 || !['knowledge.read', 'knowledge.runner'].includes(data.scopes[0])) throw new Error('Invalid approval.');
      if (data.scopes[0] === 'knowledge.runner') {
        if (permission.owner !== true) throw new Error('Owner connection required.');
        $('heading').textContent = 'Approve Mac retrieval worker';
        $('description').textContent = 'Authorize this separate read-only Mac worker to claim library lookups from owner-approved accounts and publish bounded excerpts through the authenticated gateway. The full index and Qdrant remain local. This does not grant shell access, arbitrary file reads, chat access or research execution. Pending lookups expire after 48 hours and completed results after one hour. Revoking this worker stops further claims and publication.';
        $('approve').textContent = 'Approve Mac retrieval worker';
      }
      state.approval = data;
      $('client').textContent = 'Connecting app: ' + data.clientName + '. Callback host: ' + data.redirectHost + '.';
      $('consent').hidden = false; status('Review this read-only connection, then explicitly approve it.'); controls();
    } catch { if (epoch === state.epoch) status('The connection is unavailable or expired. Check your account and start connecting again from your assistant.'); }
  }
  $('approve').addEventListener('click', async function () {
    if (state.busy || !state.user || !state.approval || state.approval.expiresAt <= Date.now()) return;
    var epoch = state.epoch, approval = state.approval;
    state.busy = true; controls();
    try {
      var ticket = await call({ action: approval.scopes[0] === 'knowledge.runner' ? 'knowledge-runner-connect' : 'knowledge-connect', nonce: nonce, clientId: approval.clientId });
      if (epoch !== state.epoch) return;
      if (!/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(ticket.ticket || '')) throw new Error('Invalid ticket.');
      var data = await workerJson('/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: nonce, ticket: ticket.ticket }) });
      if (epoch !== state.epoch) return;
      var redirect = new URL(data.redirectTo);
      if (redirect.host !== approval.redirectHost || redirect.username || redirect.password || redirect.hash || !(redirect.protocol === 'https:' || redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname))) throw new Error('Invalid callback.');
      window.location.assign(redirect.href);
    } catch { if (epoch === state.epoch) status('No connection success was confirmed. Sign in again with the invited account, then try approving or start a fresh connection.'); }
    finally { if (epoch === state.epoch) { state.busy = false; controls(); } }
  });
  $('cancel').addEventListener('click', function () { if (state.busy) return; state.epoch += 1; nonce = null; resetCopy(); state.approval = null; $('consent').hidden = true; $('client').textContent = ''; window.history.replaceState(null, '', window.location.pathname); status('Connection canceled.'); controls(); });
  ['google', 'github'].forEach(function (provider) { $(provider).addEventListener('click', function () { window.siteAuth.signIn(provider + '.com').then(load).catch(function () { status('Sign-in failed. Try again with the invited account.'); }); }); });
  function onUser(user) {
    resetCopy(); state.epoch += 1; state.user = user; state.busy = false; state.approval = null;
    $('consent').hidden = true; $('client').textContent = ''; controls();
    if (user) load(); else status('Sign in to check your knowledge access.');
  }
  function boot() {
    if (!window.siteAuth) { status('Sign-in is unavailable. Reload to try again.'); return; }
    window.siteAuth.onChange(onUser); window.siteAuth.ready().catch(function () { status('Your sign-in could not be restored.'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
}());
