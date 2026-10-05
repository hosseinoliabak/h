(function () {
  'use strict';
  if (!document.getElementById('account-admin')) return;
  var state = { user: null, epoch: 0, busy: false, page: 1, pages: 1, pending: null };
  function $(id) { return document.getElementById('aa-' + id); }
  function node(tag, text, className) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  function message(text) { $('status').textContent = text; }
  function date(value) { return value ? new Date(value).toLocaleString() : 'Never recorded'; }
  function controls() {
    document.querySelectorAll('#account-admin button, #account-admin input, #account-admin select').forEach(function (b) { b.disabled = state.busy; });
    $('prev').disabled = state.busy || state.page <= 1; $('next').disabled = state.busy || state.page >= state.pages;
  }
  function clearPrivate() {
    state.pending = null;
    if ($('confirm').open) $('confirm').close();
    $('confirm-text').textContent = '';
    $('rows').replaceChildren(); $('stats').replaceChildren(); $('summary').textContent = ''; $('query').value = ''; $('panel').hidden = true;
  }
  async function call(data) {
    var epoch = state.epoch;
    var service = await window.siteAuth.firebaseFunctions();
    if (epoch !== state.epoch || !state.user) throw new Error('Session changed.');
    var result = await service.httpsCallable('siteAdmin', { timeout: 60000, limitedUseAppCheckTokens: true })(data);
    if (epoch !== state.epoch || !state.user) throw new Error('Session changed.');
    if (!result || !result.data || typeof result.data !== 'object') throw new Error('Invalid account response.');
    return result.data;
  }
  async function run(action, done) {
    if (state.busy) return;
    var epoch = state.epoch; state.busy = true; controls();
    try { var value = await action(); if (epoch === state.epoch) done(value); }
    catch (error) { if (epoch === state.epoch) {
      if (/permission|unauthenticated/.test(error.code || '')) { clearPrivate(); message('Administrator access is required. Sign in to the correct account.'); }
      else message('The request could not be completed. No success was confirmed. Check access and try again.');
    } }
    finally { if (epoch === state.epoch) { state.busy = false; controls(); } }
  }
  function actionButton(label, action, account) {
    var button = node('button', label, 'tool-button'); button.type = 'button';
    button.addEventListener('click', function () {
      state.pending = { action: action, uid: account.uid };
      $('confirm-text').textContent = label + ' for ' + (account.email || account.handle || account.uid) + '?';
      $('confirm').showModal();
    }); return button;
  }
  function draw(data) {
    if (!Array.isArray(data.rows) || data.rows.length > 50 || !Number.isSafeInteger(data.page) || !Number.isSafeInteger(data.pages) || !Number.isSafeInteger(data.total) || !data.stats || !Number.isFinite(data.snapshotAt)) throw new Error('Invalid directory.');
    var stats = document.createDocumentFragment();
    [['total', 'Accounts'], ['enabled', 'Enabled'], ['disabled', 'Disabled'], ['recent', 'Signed in last 7 days'], ['new', 'Created last 7 days'], ['anonymous', 'Anonymous']].forEach(function (item) {
      if (!Number.isSafeInteger(data.stats[item[0]]) || data.stats[item[0]] < 0) throw new Error('Invalid statistics.');
      var card = node('div', undefined, 'aa-stat'); card.appendChild(node('strong', String(data.stats[item[0]]))); card.appendChild(node('span', item[1])); stats.appendChild(card);
    });
    var rows = document.createDocumentFragment();
    data.rows.forEach(function (account) {
      if (!account || typeof account.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(account.uid) || ['name', 'email', 'handle'].some(function (k) { return typeof account[k] !== 'string' || account[k].length > 1000; }) || typeof account.disabled !== 'boolean' || typeof account.protected !== 'boolean' || !Number.isSafeInteger(account.count) || account.count < 0 || !Number.isFinite(account.lastSignInAt) || !Number.isFinite(account.createdAt)) throw new Error('Invalid account.');
      var tr = node('tr'), who = node('td');
      [account.name || 'Unnamed', account.email, account.handle ? '@' + account.handle : '', account.uid].filter(Boolean).forEach(function (value, index) { var field = node('span', value); field.dir = index === 0 ? 'auto' : 'ltr'; who.appendChild(field); });
      tr.appendChild(who); tr.appendChild(node('td', account.protected ? 'Administrator' : account.disabled ? 'Disabled' : 'Enabled'));
      tr.appendChild(node('td', date(account.lastSignInAt))); tr.appendChild(node('td', String(account.count))); tr.appendChild(node('td', date(account.createdAt)));
      var actions = node('td');
      if (!account.protected) { actions.appendChild(actionButton(account.disabled ? 'Enable' : 'Disable', account.disabled ? 'enable' : 'disable', account)); actions.appendChild(actionButton('Revoke sessions', 'revoke', account)); }
      tr.appendChild(actions); rows.appendChild(tr);
    });
    $('stats').replaceChildren(stats); $('rows').replaceChildren(rows); $('panel').hidden = false;
    state.page = data.page; state.pages = data.pages;
    $('page').textContent = 'Page ' + data.page + ' of ' + data.pages;
    $('summary').textContent = data.total + ' matching accounts. Snapshot ' + date(data.snapshotAt) + '. Directory snapshots may be cached for up to one minute.';
    message('Administrator directory ready.'); controls();
  }
  function list(page) { return run(function () { return call({ action: 'list', page: page, pageSize: Number($('size').value), query: $('query').value, sort: $('sort').value, filter: $('filter').value }); }, draw); }
  $('form').addEventListener('submit', function (event) { event.preventDefault(); list(1); });
  ['size', 'sort', 'filter'].forEach(function (key) { $(key).addEventListener('change', function () { list(1); }); });
  $('refresh').addEventListener('click', function () { list(state.page); });
  $('prev').addEventListener('click', function () { list(state.page - 1); }); $('next').addEventListener('click', function () { list(state.page + 1); });
  $('confirm-no').addEventListener('click', function () { state.pending = null; $('confirm').close(); });
  $('confirm').addEventListener('cancel', function () { state.pending = null; });
  $('confirm-yes').addEventListener('click', function () {
    if (!state.pending) return;
    var action = state.pending; state.pending = null; $('confirm').close();
    var epoch = state.epoch;
    run(function () { return call(action); }, function (value) { if (value.saved !== true) throw new Error('No confirmation received.'); message('Account action completed.'); window.setTimeout(function () { if (state.user && epoch === state.epoch) list(state.page); }, 0); });
  });
  ['google', 'github'].forEach(function (provider) { $(provider).addEventListener('click', function () { window.siteAuth.signIn(provider + '.com').catch(function () { message('Sign-in failed. Try again.'); }); }); });
  function onUser(user) {
    if (user && state.user && user.uid === state.user.uid) return;
    state.epoch += 1; state.user = user; state.busy = false; state.page = 1; state.pages = 1; state.pending = null;
    clearPrivate(); $('login').hidden = !!user;
    controls();
    if (user) { message('Verifying administrator access.'); list(1); } else message('Sign in to an administrator account to open this panel.');
  }
  function boot() { if (!window.siteAuth) { message('Sign-in is unavailable. Reload to try again.'); return; } window.siteAuth.onChange(onUser); window.siteAuth.ready().catch(function () { message('Your sign-in could not be restored.'); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
}());
