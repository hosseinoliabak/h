/* Site-wide identity for H's Notes.
 *
 * Sign-in exists so a reader's progress (reading position, chess training,
 * course completion) follows them between devices. It deliberately gates
 * nothing else. Every page on this site is public and lives in a public
 * repository, so a login wall over the content would be decoration.
 *
 * Identity comes from Google or GitHub. Nothing personal is ever written to
 * the database: the record under users/<uid> holds a self-chosen handle and
 * progress, never the provider's name or email address. The provider's real
 * name is deliberately not read, because it would end up on a public
 * leaderboard.
 *
 * The Firebase SDK is ~250 KB, so it is fetched only when this browser has
 * signed in before or the reader actually clicks sign in. A first-time
 * visitor reading a notes page pays nothing.
 *
 * Public surface (window.siteAuth), mirroring window.siteChrome:
 *   siteAuth.user()                current firebase user, or null
 *   siteAuth.handle()              chosen display handle, or null
 *   siteAuth.onChange(fn)          called with (user) on every state change
 *   siteAuth.signIn('google.com' | 'github.com')
 *   siteAuth.signOut()
 *   siteAuth.ref(path)             users/<uid>/<path> ref, or null
 *   siteAuth.db()                  raw database handle, or null
 *   siteAuth.setHandle(name)       promise, validates and stores the handle
 *   siteAuth.askHandle()           promise, opens the handle chooser
 */
(function () {
  'use strict';

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.0/';
  var SEEN_KEY = 'site-auth-seen';           // "this browser has signed in before"
  var HANDLE_KEY = 'site-auth-handle';       // cached so the navbar can render before the SDK loads
  var RECAPTCHA = '6LdhmdosAAAAAGh4ojYqXCU0JOeVo3X-R1qmMaZq';

  var CONFIG = {
    apiKey: 'AIzaSyDpRFBtX8LUmZmEX7VcIeMxQKQOtLVdf-A',
    authDomain: 'oliabak-paste.firebaseapp.com',
    databaseURL: 'https://oliabak-paste-default-rtdb.firebaseio.com',
    projectId: 'oliabak-paste',
    storageBucket: 'oliabak-paste.firebasestorage.app',
    messagingSenderId: '968986695208',
    appId: '1:968986695208:web:fc5f3d37911810b2e0471d'
  };

  var PROVIDERS = [
    { id: 'github.com', label: 'GitHub', note: 'recommended' },
    { id: 'google.com', label: 'Google', note: '' }
  ];

  var listeners = [];
  var currentUser = null;
  var currentHandle = null;
  var db = null;
  var loading = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('blocked: ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* Load the SDK once. Resolves to true when Firebase is usable. */
  function loadSDK() {
    if (loading) return loading;
    loading = (function () {
      if (window.firebase && window.firebase.auth) return Promise.resolve(true);
      return loadScript(SDK + 'firebase-app-compat.js')
        .then(function () {
          return Promise.all([
            loadScript(SDK + 'firebase-auth-compat.js'),
            loadScript(SDK + 'firebase-database-compat.js'),
            loadScript(SDK + 'firebase-app-check-compat.js')
          ]);
        })
        .then(function () { return true; })
        .catch(function () { return false; });
    })().then(function (ok) {
      if (!ok) return false;
      try {
        // The tool pages initialise the same project; reuse their app if present.
        if (!window.firebase.apps.length) {
          window.firebase.initializeApp(CONFIG);
          window.firebase.appCheck().activate(RECAPTCHA, true);
        }
        db = window.firebase.database();
        watchAuth();
        return true;
      } catch (e) {
        return false;
      }
    });
    return loading;
  }

  function emit() {
    listeners.forEach(function (fn) { try { fn(currentUser); } catch (e) {} });
    render();
  }

  function watchAuth() {
    window.firebase.auth().onAuthStateChanged(function (user) {
      // An anonymous session (the chess page opens one) is not a signed-in reader.
      currentUser = user && !user.isAnonymous ? user : null;
      if (currentUser) {
        lsSet(SEEN_KEY, '1');
        touch();
        pullHandle();
      } else {
        currentHandle = null;
        lsDel(HANDLE_KEY);
      }
      emit();
    });
    // A popup that fell back to a redirect finishes here.
    try { window.firebase.auth().getRedirectResult().catch(function () {}); } catch (e) {}
  }

  /* Stamp last activity. This is what the 24-month retention job reads, and
     it is the only reason the record needs a timestamp at all. */
  function touch() {
    if (!db || !currentUser) return;
    var meta = db.ref('users/' + currentUser.uid + '/meta');
    meta.child('createdAt').transaction(function (cur) {
      return cur === null ? Date.now() : cur;
    }).catch(function () {});
    meta.child('lastSeenAt').set(Date.now()).catch(function () {});
  }

  function pullHandle() {
    if (!db || !currentUser) return;
    db.ref('users/' + currentUser.uid + '/meta/handle').once('value').then(function (snap) {
      currentHandle = snap.val() || null;
      if (currentHandle) lsSet(HANDLE_KEY, currentHandle); else lsDel(HANDLE_KEY);
      emit();
    }).catch(function () {});
  }

  function cleanHandle(s) {
    return String(s || '').replace(/[^A-Za-z0-9 -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  }

  function setHandle(name) {
    var clean = cleanHandle(name);
    if (clean.length < 2) return Promise.reject(new Error('too short'));
    if (!db || !currentUser) return Promise.reject(new Error('signed out'));
    return db.ref('users/' + currentUser.uid + '/meta').update({
      handle: clean, handleChangedAt: Date.now()
    }).then(function () {
      currentHandle = clean;
      lsSet(HANDLE_KEY, clean);
      emit();
      return clean;
    });
  }

  function signIn(providerId) {
    return loadSDK().then(function (ok) {
      if (!ok) throw new Error('Firebase could not load. A content blocker is the usual cause.');
      var auth = window.firebase.auth();
      var provider = providerId === 'github.com'
        ? new window.firebase.auth.GithubAuthProvider()
        : new window.firebase.auth.GoogleAuthProvider();
      // No extra scopes are requested: the default profile is never stored.
      return auth.signInWithPopup(provider).catch(function (err) {
        var code = (err && err.code) || '';
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
          return auth.signInWithRedirect(provider);
        }
        throw err;
      });
    });
  }

  function signOut() {
    lsDel(SEEN_KEY);
    lsDel(HANDLE_KEY);
    if (!window.firebase || !window.firebase.auth) return Promise.resolve();
    return window.firebase.auth().signOut().catch(function () {});
  }

  /* ------------------------------ handle chooser ------------------------------ */

  function askHandle() {
    return new Promise(function (resolve) {
      var back = document.createElement('div');
      back.className = 'site-auth-modal';
      var box = document.createElement('div');
      box.className = 'site-auth-card';

      var h = document.createElement('h3');
      h.textContent = 'Choose a display name';
      var p = document.createElement('p');
      p.textContent = 'This is the only name stored, and the one shown on the chess leaderboard. '
        + 'Your real name and email address are never saved. Letters, numbers, spaces, and dashes, up to 20 characters.';

      var input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 20;
      input.value = currentHandle || '';
      input.placeholder = 'e.g. knight-tamer';

      var err = document.createElement('div');
      err.className = 'site-auth-err';

      var row = document.createElement('div');
      row.className = 'site-auth-row';
      var save = document.createElement('button');
      save.className = 'site-auth-btn';
      save.textContent = 'Save';
      var cancel = document.createElement('button');
      cancel.className = 'site-auth-btn site-auth-btn-quiet';
      cancel.textContent = 'Not now';

      function close(v) { back.remove(); resolve(v); }
      save.onclick = function () {
        setHandle(input.value).then(close).catch(function () {
          err.textContent = 'Use at least 2 characters (letters, numbers, spaces, dashes).';
        });
      };
      cancel.onclick = function () { close(null); };
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') save.click(); });
      back.addEventListener('click', function (e) { if (e.target === back) close(null); });

      row.append(cancel, save);
      box.append(h, p, input, err, row);
      back.appendChild(box);
      document.body.appendChild(back);
      input.focus();
    });
  }

  /* --------------------------------- navbar UI -------------------------------- */

  function render() {
    var host = document.getElementById('site-auth');
    if (!host) return;
    host.textContent = '';

    if (currentUser) {
      var name = currentHandle || lsGet(HANDLE_KEY) || 'Set name';
      var who = document.createElement('button');
      who.className = 'site-auth-btn site-auth-btn-quiet';
      who.textContent = name;
      who.title = 'Change your display name';
      who.onclick = function () { askHandle(); };

      var out = document.createElement('button');
      out.className = 'site-auth-btn site-auth-btn-quiet';
      out.textContent = 'Sign out';
      out.onclick = function () { signOut(); };

      host.append(who, out);
      if (!currentHandle) askHandleOnce();
      return;
    }

    var btn = document.createElement('button');
    btn.className = 'site-auth-btn';
    btn.textContent = 'Sign in';
    btn.title = 'Sign in to keep your progress across devices';
    btn.onclick = function () { openMenu(host, btn); };
    host.appendChild(btn);
  }

  var asked = false;
  function askHandleOnce() {
    if (asked) return;
    asked = true;
    askHandle();
  }

  function openMenu(host, anchor) {
    var existing = host.querySelector('.site-auth-menu');
    if (existing) { existing.remove(); return; }

    var menu = document.createElement('div');
    menu.className = 'site-auth-menu';

    var intro = document.createElement('p');
    intro.textContent = 'Keeps your reading position and chess progress across devices. No email or personal details are stored.';
    menu.appendChild(intro);

    PROVIDERS.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'site-auth-btn';
      b.textContent = p.note ? p.label + ' (' + p.note + ')' : p.label;
      b.onclick = function () {
        b.disabled = true;
        signIn(p.id).catch(function (e) {
          b.disabled = false;
          var msg = menu.querySelector('.site-auth-err') || document.createElement('div');
          msg.className = 'site-auth-err';
          msg.textContent = (e && e.message) || 'Sign-in failed. Please try again.';
          menu.appendChild(msg);
        });
      };
      menu.appendChild(b);
    });

    host.appendChild(menu);
    setTimeout(function () {
      document.addEventListener('click', function away(e) {
        if (!host.contains(e.target)) { menu.remove(); document.removeEventListener('click', away); }
      });
    }, 0);
  }

  function mount() {
    if (document.getElementById('site-auth')) return;
    var host = document.createElement('div');
    host.id = 'site-auth';
    var tools = document.querySelector('.quarto-navbar-tools');
    if (tools) {
      tools.insertBefore(host, tools.firstChild);
    } else {
      var nav = document.querySelector('.navbar-container');
      if (!nav) return;
      nav.appendChild(host);
    }
    render();
  }

  /* ---------------------------------- public ---------------------------------- */

  window.siteAuth = {
    user: function () { return currentUser; },
    handle: function () { return currentHandle; },
    onChange: function (fn) {
      if (typeof fn !== 'function') return;
      listeners.push(fn);
      fn(currentUser);
    },
    signIn: signIn,
    signOut: signOut,
    setHandle: setHandle,
    askHandle: askHandle,
    db: function () { return db; },
    ref: function (path) {
      if (!db || !currentUser) return null;
      return db.ref('users/' + currentUser.uid + (path ? '/' + path : ''));
    },
    /* Pages that want the session without forcing a sign-in prompt. Resolves
       once the SDK has settled, or immediately when there is nothing to load. */
    ready: function () {
      if (lsGet(SEEN_KEY) !== '1') return Promise.resolve(null);
      return loadSDK().then(function () { return currentUser; });
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    mount();
    // Returning readers get the SDK straight away so the navbar shows them signed in.
    if (lsGet(SEEN_KEY) === '1') loadSDK();
  });
})();
