/* Short Links tool.
 *
 * This file only draws what the server says. Every decision about who may
 * create a link, what a link may point to, and which code it gets is made by
 * the code behind /api/short-links (source in tools/short-links-worker.js),
 * which verifies the sign-in token on every call. Nothing here is an
 * authorization boundary.
 *
 * Text that came from a user or from the server is written with textContent.
 * Addresses become links only after their scheme is checked here again.
 */
(function () {
  'use strict';

  var API = '/api/short-links';
  var REQUEST_TIMEOUT_MS = 15000;
  var FEEDBACK_MS = 2000;
  var CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
  var UID_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
  var HANDLE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,19}$/;

  var root = document.getElementById('short-links');
  if (!root) return;

  function $(id) { return document.getElementById(id); }

  var ui = {
    message: $('sl-message'),
    account: $('sl-account'),
    auth: $('sl-auth'),
    signInGithub: $('sl-signin-github'),
    signInGoogle: $('sl-signin-google'),
    create: $('sl-create'),
    form: $('sl-form'),
    url: $('sl-url'),
    alias: $('sl-alias'),
    aliasPrefix: $('sl-alias-prefix'),
    submit: $('sl-submit'),
    result: $('sl-result'),
    resultInput: $('sl-result-url'),
    resultCopy: $('sl-result-copy'),
    resultOpen: $('sl-result-open'),
    mine: $('sl-mine'),
    list: $('sl-list'),
    empty: $('sl-empty'),
    count: $('sl-count'),
    owner: $('sl-owner'),
    accessForm: $('sl-access-form'),
    accessInput: $('sl-access-input'),
    accessSubmit: $('sl-access-submit'),
    accessMessage: $('sl-access-message'),
    members: $('sl-members'),
    all: $('sl-all'),
    allRefresh: $('sl-all-refresh'),
    allMore: $('sl-all-more')
  };

  var state = { user: null, status: null, links: [], allCursor: null, busy: false };

  /* ------------------------------ helpers ------------------------------ */

  function show(node, visible) { if (node) node.hidden = !visible; }

  function setStatus(node, text, tone) {
    node.textContent = text || '';
    if (tone) node.setAttribute('data-tone', tone);
    else node.removeAttribute('data-tone');
  }

  function setMessage(text, tone) { setStatus(ui.message, text, tone); }

  function isWebUrl(value) {
    if (typeof value !== 'string') return false;
    try {
      var parsed = new URL(value);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (error) {
      return false;
    }
  }

  function siteOrigin() {
    if (state.status && isWebUrl(state.status.origin)) return new URL(state.status.origin).origin;
    return window.location.origin;
  }

  function shortUrlFor(code) {
    if (typeof code !== 'string' || !CODE_PATTERN.test(code)) return '';
    return siteOrigin() + '/' + code;
  }

  function displayShort(code) {
    var url = shortUrlFor(code);
    return url ? url.replace(/^https?:\/\//, '') : String(code || '');
  }

  function formatDate(stamp) {
    if (!Number.isFinite(stamp) || stamp <= 0) return '';
    try {
      return new Date(stamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (error) {
      return '';
    }
  }

  function button(label, onClick, className) {
    var node = document.createElement('button');
    node.type = 'button';
    node.className = 'tool-button' + (className ? ' ' + className : '');
    node.textContent = label;
    node.addEventListener('click', onClick);
    return node;
  }

  function flash(node, label) {
    var original = node.textContent;
    node.textContent = label;
    node.disabled = true;
    window.setTimeout(function () {
      node.textContent = original;
      node.disabled = false;
    }, FEEDBACK_MS);
  }

  function errorText(error) {
    if (error && error.name === 'AbortError') return 'The request took too long. Check your connection and try again.';
    if (error && error.message === 'signed-out') return 'You are signed out. Sign in and try again.';
    if (error && typeof error.message === 'string' && error.message) return error.message;
    return 'Something went wrong. Try again.';
  }

  /* ------------------------------ clipboard ------------------------------ */

  function selectForManualCopy(value) {
    ui.resultInput.value = value;
    show(ui.result, true);
    show(ui.resultOpen, isWebUrl(value));
    if (isWebUrl(value)) ui.resultOpen.href = value;
    ui.resultInput.focus();
    ui.resultInput.select();
    setMessage('Copying is blocked in this browser. The link is selected above, so press Command + C or Ctrl + C to copy it.', 'error');
  }

  function copyText(value, trigger) {
    if (!window.isSecureContext || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      selectForManualCopy(value);
      return;
    }
    navigator.clipboard.writeText(value).then(function () {
      flash(trigger, 'Copied');
    }, function () {
      selectForManualCopy(value);
    });
  }

  /* ------------------------------ api ------------------------------ */

  function idToken() {
    var user = window.siteAuth && window.siteAuth.user();
    if (!user || typeof user.getIdToken !== 'function') return Promise.reject(new Error('signed-out'));
    return user.getIdToken();
  }

  function api(method, path, body) {
    return idToken().then(function (token) {
      var controller = new AbortController();
      var timer = window.setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
      var init = {
        method: method,
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal
      };
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      /* Every call gets a URL of its own. The edge cache keys on the URL and
         has been seen to keep responses despite no-store, so a fixed URL could
         hand one reader's answer to the next. */
      var buster = (path.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      return fetch(API + path + buster, init).then(function (response) {
        return response.text().then(function (raw) {
          var data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (error) { data = null; }
          if (!response.ok) {
            var failure = new Error((data && typeof data.message === 'string' && data.message) || ('The request failed (' + response.status + ').'));
            failure.code = data && data.error;
            failure.status = response.status;
            throw failure;
          }
          return data || {};
        });
      }).finally(function () { window.clearTimeout(timer); });
    });
  }

  /* ------------------------------ rendering ------------------------------ */

  function linkItem(link, options) {
    var li = document.createElement('li');
    li.className = 'sl-item';
    var shortUrl = shortUrlFor(link.code);

    var head = document.createElement('div');
    head.className = 'tool-list-head';
    var short = document.createElement('a');
    short.className = 'tool-list-title sl-short';
    short.textContent = displayShort(link.code);
    if (shortUrl) {
      short.href = shortUrl;
      short.target = '_blank';
      short.rel = 'noopener noreferrer';
    }
    head.appendChild(short);

    var actions = document.createElement('div');
    actions.className = 'tool-list-actions';
    var copy = button('Copy', function () { copyText(shortUrl || displayShort(link.code), copy); });
    actions.appendChild(copy);
    if (options.canDelete) {
      var remove = button('Delete', function () { deleteLink(link, li, remove, options); }, 'tool-button-danger');
      actions.appendChild(remove);
    }
    head.appendChild(actions);
    li.appendChild(head);

    var target = document.createElement('div');
    target.className = 'sl-target';
    var targetText = String(link.url || '') + (link.truncated ? ' (address shortened for display)' : '');
    if (isWebUrl(link.url) && !link.truncated) {
      var anchor = document.createElement('a');
      anchor.href = link.url;
      anchor.textContent = targetText;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      target.appendChild(anchor);
    } else {
      target.textContent = targetText;
    }
    li.appendChild(target);

    var meta = document.createElement('div');
    meta.className = 'tool-list-meta';
    var parts = [];
    var created = formatDate(link.createdAt);
    if (created) parts.push('Created ' + created);
    if (options.showOwner && typeof link.owner === 'string' && link.owner) {
      parts.push(link.owner === state.status.uid ? 'Created by you' : 'Account ' + link.owner);
    }
    meta.textContent = parts.join(' · ');
    li.appendChild(meta);
    return li;
  }

  function renderMine() {
    ui.list.replaceChildren();
    state.links.forEach(function (link) {
      ui.list.appendChild(linkItem(link, { canDelete: true, list: 'mine' }));
    });
    show(ui.empty, state.links.length === 0);
    var limit = state.status && state.status.limits && Number.isFinite(state.status.limits.maxLinks) ? state.status.limits.maxLinks : null;
    ui.count.textContent = state.links.length + (limit ? ' of ' + limit : '') + (state.links.length === 1 ? ' link' : ' links');
  }

  function renderMembers(members) {
    ui.members.replaceChildren();
    if (!members.length) {
      var none = document.createElement('li');
      none.className = 'sl-item tool-note';
      none.textContent = 'Nobody else can create links yet.';
      ui.members.appendChild(none);
      return;
    }
    members.forEach(function (member) {
      var li = document.createElement('li');
      li.className = 'sl-item';
      var head = document.createElement('div');
      head.className = 'tool-list-head';
      var name = document.createElement('span');
      name.className = 'tool-list-title';
      name.textContent = member.handle || 'Unnamed account';
      head.appendChild(name);
      var actions = document.createElement('div');
      actions.className = 'tool-list-actions';
      var revoke = button('Remove', function () { revokeAccess(member, li, revoke); }, 'tool-button-danger');
      actions.appendChild(revoke);
      head.appendChild(actions);
      li.appendChild(head);
      var meta = document.createElement('div');
      meta.className = 'tool-list-meta';
      var granted = formatDate(member.grantedAt);
      meta.textContent = 'Account ' + member.uid + (granted ? ' · allowed ' + granted : '');
      li.appendChild(meta);
      ui.members.appendChild(li);
    });
  }

  function renderAll(links, append) {
    if (!append) ui.all.replaceChildren();
    if (!links.length && !append) {
      var none = document.createElement('li');
      none.className = 'sl-item tool-note';
      none.textContent = 'No links exist yet.';
      ui.all.appendChild(none);
    }
    links.forEach(function (link) {
      ui.all.appendChild(linkItem(link, { canDelete: true, showOwner: true, list: 'all' }));
    });
    show(ui.allMore, Boolean(state.allCursor));
  }

  function renderAccess() {
    var status = state.status;
    var handle = window.siteAuth && window.siteAuth.handle();
    var who = handle ? 'Signed in as ' + handle + '.' : 'Signed in.';
    show(ui.auth, false);
    ui.account.replaceChildren();
    if (!status.configured) {
      setMessage('Short links are not switched on for this site yet.', 'error');
      ui.account.textContent = who + ' Your account id is ';
      var idNode = document.createElement('code');
      idNode.textContent = status.uid;
      ui.account.appendChild(idNode);
      ui.account.appendChild(document.createTextNode('.'));
      show(ui.account, true);
      show(ui.create, false);
      show(ui.mine, false);
      show(ui.owner, false);
      return;
    }
    var limits = status.limits && Number.isFinite(status.limits.maxLinks) ? status.limits : null;
    if (status.role === 'guest') {
      var guestMax = limits ? limits.maxLinks : 1;
      setMessage(guestMax === 1
        ? 'You can create one short link without an invitation.'
        : 'You can create up to ' + guestMax + ' short links without an invitation.', 'ok');
      ui.account.textContent = who + ' Invited accounts can keep hundreds. '
        + (handle ? 'Ask the site owner to invite this name if you need more.' : 'Set a display name from the menu so the owner can invite your account if you need more.');
    } else if (status.role === 'owner' || status.role === 'member') {
      setMessage(status.role === 'owner' ? 'You are the site owner. You can create links and choose who else may keep more than a few.' : 'You can create short links.', 'ok');
      ui.account.textContent = who;
    } else {
      setMessage('Your account cannot create short links.', '');
      ui.account.textContent = who;
      show(ui.account, true);
      show(ui.create, false);
      show(ui.mine, false);
      show(ui.owner, false);
      return;
    }
    show(ui.account, true);
    ui.aliasPrefix.textContent = siteOrigin().replace(/^https?:\/\//, '') + '/';
    show(ui.create, true);
    show(ui.mine, true);
    renderMine();
    show(ui.owner, status.role === 'owner');
    if (status.role === 'owner') {
      loadMembers();
      loadAll(false);
      /* The dashboard links straight to the admin panels, which are hidden
         until the server confirms the owner, so the fragment scroll has to
         be repeated once they exist. */
      if (window.location.hash === '#sl-owner' && typeof ui.owner.scrollIntoView === 'function') {
        ui.owner.scrollIntoView({ block: 'start' });
      }
    }
  }

  function renderSignedOut() {
    state.status = null;
    setMessage('Sign in to see whether short links are enabled for your account.', '');
    show(ui.account, false);
    show(ui.auth, true);
    show(ui.create, false);
    show(ui.mine, false);
    show(ui.owner, false);
  }

  /* ------------------------------ actions ------------------------------ */

  function refresh() {
    setMessage('Checking your access.', '');
    return api('GET', '').then(function (status) {
      if (!status || typeof status !== 'object') throw new Error('The server sent an unexpected reply.');
      state.status = status;
      state.links = Array.isArray(status.links) ? status.links.filter(function (link) {
        return link && typeof link.code === 'string' && CODE_PATTERN.test(link.code);
      }) : [];
      renderAccess();
    }).catch(function (error) {
      state.status = null;
      show(ui.create, false);
      show(ui.mine, false);
      show(ui.owner, false);
      setMessage(errorText(error), 'error');
    });
  }

  function createLink(event) {
    event.preventDefault();
    if (state.busy) return;
    var url = ui.url.value.trim();
    var alias = ui.alias.value.trim();
    if (!url) {
      setMessage('Enter the address to shorten.', 'error');
      ui.url.focus();
      return;
    }
    if (!isWebUrl(url)) {
      setMessage('Enter a complete address that starts with https:// or http://.', 'error');
      ui.url.focus();
      return;
    }
    state.busy = true;
    ui.submit.disabled = true;
    setMessage('Creating the link.', '');
    var body = { url: url };
    if (alias) body.alias = alias;
    api('POST', '', body).then(function (created) {
      if (!created || typeof created.code !== 'string' || !CODE_PATTERN.test(created.code)) {
        throw new Error('The server sent an unexpected reply.');
      }
      var shortUrl = shortUrlFor(created.code);
      ui.resultInput.value = shortUrl;
      show(ui.resultOpen, Boolean(shortUrl));
      if (shortUrl) ui.resultOpen.href = shortUrl;
      show(ui.result, true);
      ui.resultInput.focus();
      ui.resultInput.select();
      state.links.unshift({ code: created.code, url: created.url, truncated: false, createdAt: created.createdAt });
      renderMine();
      ui.form.reset();
      setMessage('Your short link is ready.', 'ok');
    }).catch(function (error) {
      setMessage(errorText(error), 'error');
    }).finally(function () {
      state.busy = false;
      ui.submit.disabled = false;
    });
  }

  function deleteLink(link, item, trigger, options) {
    var label = displayShort(link.code);
    if (!window.confirm('Delete ' + label + '? Anyone who has it will see a not-found page.')) return;
    trigger.disabled = true;
    api('DELETE', '/' + encodeURIComponent(link.code)).then(function () {
      item.remove();
      state.links = state.links.filter(function (entry) { return entry.code !== link.code; });
      renderMine();
      /* The owner sees the same link in two lists. Deleting from "Your links"
         leaves a stale row in "Every link", so that list is reloaded. */
      if (options.list !== 'all' && state.status && state.status.role === 'owner') loadAll(false);
      setMessage('Deleted ' + label + '.', 'ok');
    }).catch(function (error) {
      trigger.disabled = false;
      setMessage(errorText(error), 'error');
    });
  }

  function loadMembers() {
    return api('GET', '/access').then(function (data) {
      var members = data && Array.isArray(data.members) ? data.members.filter(function (member) {
        return member && typeof member.uid === 'string';
      }) : [];
      renderMembers(members);
    }).catch(function (error) {
      setStatus(ui.accessMessage, errorText(error), 'error');
    });
  }

  function loadAll(append) {
    var path = '/all' + (append && state.allCursor ? '?cursor=' + encodeURIComponent(state.allCursor) : '');
    ui.allRefresh.disabled = true;
    ui.allMore.disabled = true;
    return api('GET', path).then(function (data) {
      var links = data && Array.isArray(data.links) ? data.links.filter(function (link) {
        return link && typeof link.code === 'string' && CODE_PATTERN.test(link.code);
      }) : [];
      state.allCursor = data && typeof data.cursor === 'string' && data.cursor ? data.cursor : null;
      renderAll(links, Boolean(append));
    }).catch(function (error) {
      setMessage(errorText(error), 'error');
    }).finally(function () {
      ui.allRefresh.disabled = false;
      ui.allMore.disabled = false;
    });
  }

  function handleKey(value) {
    var clean = String(value || '').replace(/[^A-Za-z0-9 -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
    return { clean: clean, key: clean.toLowerCase().replace(/ /g, '-') };
  }

  function lookupHandle(value) {
    var folded = handleKey(value);
    if (!HANDLE_KEY_PATTERN.test(folded.key)) return Promise.resolve(null);
    var db = window.siteAuth && window.siteAuth.db && window.siteAuth.db();
    if (!db || typeof db.ref !== 'function') return Promise.reject(new Error('The account directory is not available right now. Enter the account id instead.'));
    return db.ref('handles/' + folded.key).once('value').then(function (snapshot) {
      var uid = snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null;
      return typeof uid === 'string' && UID_PATTERN.test(uid) ? { uid: uid, handle: folded.clean } : null;
    });
  }

  function grantAccess(event) {
    event.preventDefault();
    if (state.busy) return;
    var value = ui.accessInput.value.trim();
    if (!value) {
      setStatus(ui.accessMessage, 'Enter a display name or an account id.', 'error');
      return;
    }
    state.busy = true;
    ui.accessSubmit.disabled = true;
    setStatus(ui.accessMessage, 'Looking up the account.', '');
    var resolved = UID_PATTERN.test(value)
      ? Promise.resolve({ uid: value, handle: '' })
      : lookupHandle(value);
    resolved.then(function (target) {
      if (!target) throw new Error('No account on this site uses that name. Ask the person for their account id.');
      return api('POST', '/access', { uid: target.uid, handle: target.handle });
    }).then(function (granted) {
      ui.accessForm.reset();
      setStatus(ui.accessMessage, 'Allowed ' + (granted && granted.handle ? granted.handle : 'the account') + '.', 'ok');
      return loadMembers();
    }).catch(function (error) {
      setStatus(ui.accessMessage, errorText(error), 'error');
    }).finally(function () {
      state.busy = false;
      ui.accessSubmit.disabled = false;
    });
  }

  function revokeAccess(member, item, trigger) {
    var label = member.handle || member.uid;
    if (!window.confirm('Remove ' + label + '? Their existing links keep working.')) return;
    trigger.disabled = true;
    api('DELETE', '/access/' + encodeURIComponent(member.uid)).then(function () {
      item.remove();
      if (!ui.members.querySelector('li')) renderMembers([]);
      setStatus(ui.accessMessage, 'Removed ' + label + '.', 'ok');
    }).catch(function (error) {
      trigger.disabled = false;
      setStatus(ui.accessMessage, errorText(error), 'error');
    });
  }

  function signIn(provider, trigger) {
    if (!window.siteAuth) return;
    trigger.disabled = true;
    window.siteAuth.signIn(provider).catch(function () {
      trigger.disabled = false;
    });
  }

  /* ------------------------------ wiring ------------------------------ */

  ui.form.addEventListener('submit', createLink);
  ui.accessForm.addEventListener('submit', grantAccess);
  ui.resultCopy.addEventListener('click', function () {
    if (ui.resultInput.value) copyText(ui.resultInput.value, ui.resultCopy);
  });
  ui.allRefresh.addEventListener('click', function () { loadAll(false); });
  ui.allMore.addEventListener('click', function () { loadAll(true); });
  ui.signInGithub.addEventListener('click', function () { signIn('github.com', ui.signInGithub); });
  ui.signInGoogle.addEventListener('click', function () { signIn('google.com', ui.signInGoogle); });

  if (!window.siteAuth) {
    setMessage('Sign-in is not available on this page, so short links cannot be managed here.', 'error');
    return;
  }

  function onIdentity(user) {
    var previous = state.user;
    state.user = user;
    if (!user) {
      renderSignedOut();
      return;
    }
    if (previous && previous.uid === user.uid && state.status) return;
    refresh();
  }

  window.siteAuth.ready().catch(function () { return null; }).then(function () {
    window.siteAuth.onChange(onIdentity);
  });
})();
