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
 * leaderboard. The email address stays with the sign-in provider, which
 * needs it to identify the account; it is never copied into the database.
 *
 * Handles are unique, ignoring case and treating a space like a dash.
 * handles/<key> maps the folded name to the owning uid, and the rules refuse
 * a handle whose key is not held by the writer, so a claim and the handle are
 * written together in one atomic update and a rename releases the old key.
 *
 * Pages link this file by a content-hashed URL (tools/version_assets.py), so
 * a changed script is always fetched under a name the edge has never cached.
 *
 * Firebase modules are loaded after the page becomes usable. Identity asks
 * for Authentication and Database only for returning or actively signing-in
 * readers. The aggregate page counter asks for the smaller App Check and
 * Functions subset once per browser tab session.
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
 *   siteAuth.ready()               resolves after the initial auth state settles
 *   siteAuth.firebaseFunctions()   protected callable-functions service
 *   siteAuth.publicFirebaseFunctions() public aggregate callable service
 */
(function () {
  'use strict';

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.0/';
  var SEEN_KEY = 'site-auth-seen';           // "this browser has signed in before"
  var HANDLE_KEY = 'site-auth-handle';       // cached so the navbar can render before the SDK loads
  var HANDLE_OWNER_KEY = 'site-auth-handle-owner';
  var ASKED_KEY = 'site-auth-asked';         // session-scoped, so "Not now" is respected
  var CREATED_SYNC_PREFIX = 'site-auth-created-v1:';
  var LAST_SEEN_SYNC_PREFIX = 'site-auth-last-seen-v1:';
  var HANDLE_PULL_PREFIX = 'site-auth-handle-pull-v1:';
  var HANDLE_PULL_ATTEMPT_PREFIX = 'site-auth-handle-pull-attempt-v1:';
  var CREATED_VERIFY_MS = 30 * 24 * 60 * 60 * 1000;
  var CREATED_RETRY_MS = 60 * 60 * 1000;
  var LAST_SEEN_INTERVAL_MS = 6 * 60 * 60 * 1000;
  var HANDLE_PULL_INTERVAL_MS = 10 * 60 * 1000;
  var HANDLE_PULL_RETRY_MS = 60 * 1000;
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
  /* Seeded from the cache so a known name is available on the very first paint,
     before the database read returns. Without this the navbar flashes "Set
     name" and the chooser opens on a reader who already has one. */
  var currentHandle = lsGet(HANDLE_KEY) || null;
  var handleLoaded = false;
  var db = null;
  var loading = null;
  var functionsLoading = null;
  var publicFunctionsLoading = null;
  var scriptLoads = {};
  var authWatching = false;
  var resolveInitialAuthState = null;
  var initialAuthState = new Promise(function (resolve) {
    resolveInitialAuthState = resolve;
  });

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

  function clearHandlePullMarkers(uid) {
    if (!uid) return;
    ssDel(HANDLE_PULL_PREFIX + uid);
    ssDel(HANDLE_PULL_ATTEMPT_PREFIX + uid);
  }

  /* Local activity markers reduce work across tabs. Session markers are also
     written so a browser that blocks persistent storage still suppresses a
     refresh loop in the current tab. These markers are an efficiency hint.
     Database rules remain the integrity boundary. */
  function activityGet(key) {
    return lsGet(key) || ssGet(key);
  }

  function activitySet(key, value) {
    lsSet(key, value);
    ssSet(key, value);
  }

  function recentTimestamp(value, now, interval) {
    var stamp = Number(value);
    return Number.isFinite(stamp)
      && stamp > 0
      && stamp <= now + 60000
      && now - stamp < interval;
  }

  function recentState(value, state, now, interval) {
    var prefix = state + ':';
    return typeof value === 'string'
      && value.indexOf(prefix) === 0
      && recentTimestamp(value.slice(prefix.length), now, interval);
  }

  function loadScript(file, ready) {
    if (ready()) return Promise.resolve();
    if (scriptLoads[file]) return scriptLoads[file];
    scriptLoads[file] = new Promise(function (resolve, reject) {
      var url = new URL(file, SDK);
      if (url.origin !== 'https://www.gstatic.com' || url.pathname.indexOf('/firebasejs/10.12.0/') !== 0) {
        reject(new Error('Firebase module origin is not allowed'));
        return;
      }
      var finished = false;
      var timer = window.setTimeout(function () { finish(new Error('Firebase module timed out')); }, 15000);
      var poll = window.setInterval(function () {
        if (ready()) finish();
      }, 40);
      var script = Array.prototype.slice.call(document.scripts).filter(function (item) {
        return item.src === url.href;
      })[0];

      function finish(error) {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        window.clearInterval(poll);
        if (error || !ready()) reject(error || new Error('Firebase module did not initialize'));
        else resolve();
      }

      if (!script) {
        script = document.createElement('script');
        script.src = url.href;
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.referrerPolicy = 'no-referrer';
        document.head.appendChild(script);
      }
      script.addEventListener('load', function () { finish(); }, { once: true });
      script.addEventListener('error', function () { finish(new Error('Firebase module was blocked')); }, { once: true });
    }).catch(function (error) {
      delete scriptLoads[file];
      throw error;
    });
    return scriptLoads[file];
  }

  /* Load the SDK once. Resolves to true when Firebase is usable. */
  function loadSDK() {
    if (loading) return loading;
    loading = (function () {
      return loadScript('firebase-app-compat.js', function () {
        return Boolean(window.firebase && window.firebase.initializeApp);
      })
        .then(function () {
          return Promise.all([
            loadScript('firebase-auth-compat.js', function () { return Boolean(window.firebase && window.firebase.auth); }),
            loadScript('firebase-database-compat.js', function () { return Boolean(window.firebase && window.firebase.database); }),
            loadScript('firebase-app-check-compat.js', function () { return Boolean(window.firebase && window.firebase.appCheck); })
          ]);
        })
        .then(function () { return true; })
        .catch(function () { return false; });
    })().then(function (ok) {
      if (!ok) return false;
      try {
        // The tool pages initialize the same project; reuse their app if present.
        if (!window.firebase.apps.length) {
          window.firebase.initializeApp(CONFIG);
        }
        try { window.firebase.appCheck().activate(RECAPTCHA, true); } catch (e) {}
        db = window.firebase.database();
        watchAuth();
        return true;
      } catch (e) {
        return false;
      }
    });
    return loading;
  }

  /* Metrics do not need Authentication or Database in the browser. Keeping
     this path separate avoids downloading those modules for signed-out readers. */
  function loadFunctionsSDK() {
    if (functionsLoading) return functionsLoading;
    functionsLoading = loadScript('firebase-app-compat.js', function () {
      return Boolean(window.firebase && window.firebase.initializeApp);
    }).then(function () {
      return Promise.all([
        loadScript('firebase-app-check-compat.js', function () { return Boolean(window.firebase && window.firebase.appCheck); }),
        loadScript('firebase-functions-compat.js', function () { return Boolean(window.firebase && window.firebase.functions); })
      ]);
    }).then(function () {
      if (!window.firebase.apps.length) window.firebase.initializeApp(CONFIG);
      try { window.firebase.appCheck().activate(RECAPTCHA, true); } catch (e) {}
      return true;
    }).catch(function () {
      functionsLoading = null;
      return false;
    });
    return functionsLoading;
  }

  /* Public aggregate reads do not depend on browser attestation. This keeps
     the publishing dashboard available when the App Check module is blocked. */
  function loadPublicFunctionsSDK() {
    if (publicFunctionsLoading) return publicFunctionsLoading;
    publicFunctionsLoading = loadScript('firebase-app-compat.js', function () {
      return Boolean(window.firebase && window.firebase.initializeApp);
    }).then(function () {
      return loadScript('firebase-functions-compat.js', function () {
        return Boolean(window.firebase && window.firebase.functions);
      });
    }).then(function () {
      if (!window.firebase.apps.length) window.firebase.initializeApp(CONFIG);
      return true;
    }).catch(function () {
      publicFunctionsLoading = null;
      return false;
    });
    return publicFunctionsLoading;
  }

  function emit() {
    listeners.forEach(function (fn) { try { fn(currentUser); } catch (e) {} });
    render();
  }

  function waitForInitialAuthState() {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('Authentication state timed out'));
      }, 10000);
      initialAuthState.then(function (user) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(user);
      });
    });
  }

  function watchAuth() {
    if (authWatching) return;
    authWatching = true;
    window.firebase.auth().onAuthStateChanged(function (user) {
      // A legacy anonymous session is not a signed-in reader.
      var previousUser = currentUser;
      currentUser = user && !user.isAnonymous ? user : null;
      if (previousUser && (!currentUser || previousUser.uid !== currentUser.uid)) {
        clearHandlePullMarkers(previousUser.uid);
      }
      if (currentUser) {
        if (!previousUser || previousUser.uid !== currentUser.uid) {
          if (lsGet(HANDLE_OWNER_KEY) !== currentUser.uid) lsDel(HANDLE_KEY);
          currentHandle = lsGet(HANDLE_KEY) || null;
          handleLoaded = false;
        }
        lsSet(SEEN_KEY, '1');
        touch();
        pullHandle();
      } else {
        currentHandle = null;
        handleLoaded = false;
        lsDel(HANDLE_KEY);
        lsDel(HANDLE_OWNER_KEY);
      }
      if (resolveInitialAuthState) {
        resolveInitialAuthState(currentUser);
        resolveInitialAuthState = null;
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
    var uid = currentUser.uid;
    var now = Date.now();
    var meta = db.ref('users/' + uid + '/meta');
    var serverTimestamp = window.firebase.database.ServerValue.TIMESTAMP;
    var createdKey = CREATED_SYNC_PREFIX + uid;
    var createdState = activityGet(createdKey);
    var createdIsFresh = recentState(createdState, 'ok', now, CREATED_VERIFY_MS);
    var createdIsPending = recentState(createdState, 'try', now, CREATED_RETRY_MS);

    if (!createdIsFresh && !createdIsPending) {
      activitySet(createdKey, 'try:' + now);
      meta.child('createdAt').transaction(function (cur) {
        return cur === null ? serverTimestamp : cur;
      }).then(function () {
        activitySet(createdKey, 'ok:' + Date.now());
      }).catch(function () {});
    }

    var lastSeenKey = LAST_SEEN_SYNC_PREFIX + uid;
    if (!recentTimestamp(activityGet(lastSeenKey), now, LAST_SEEN_INTERVAL_MS)) {
      /* Mark the attempt before the request. An outage or a second device can
         make the server reject it, but reloads still remain bounded. */
      activitySet(lastSeenKey, String(now));
      meta.child('lastSeenAt').set(serverTimestamp).catch(function () {});
    }
  }

  function pullHandle() {
    if (!db || !currentUser) return;
    var uid = currentUser.uid;
    var now = Date.now();
    var successKey = HANDLE_PULL_PREFIX + uid;
    var attemptKey = HANDLE_PULL_ATTEMPT_PREFIX + uid;

    if (recentTimestamp(ssGet(successKey), now, HANDLE_PULL_INTERVAL_MS)) {
      handleLoaded = true;
      return;
    }
    if (recentTimestamp(ssGet(attemptKey), now, HANDLE_PULL_RETRY_MS)) return;

    ssSet(attemptKey, String(now));
    db.ref('users/' + uid + '/meta/handle').once('value').then(function (snap) {
      if (!currentUser || currentUser.uid !== uid) return;
      ssSet(successKey, String(Date.now()));
      ssDel(attemptKey);
      currentHandle = snap.val() || null;
      handleLoaded = true;          // now, and only now, is "no handle" a fact
      if (currentHandle) {
        lsSet(HANDLE_KEY, currentHandle);
        lsSet(HANDLE_OWNER_KEY, uid);
      } else {
        lsDel(HANDLE_KEY);
        lsSet(HANDLE_OWNER_KEY, uid);
      }
      emit();
    }).catch(function () {
      if (currentUser && currentUser.uid === uid) emit();
    });   // read failed: stay quiet rather than prompt
  }

  function cleanHandle(s) {
    return String(s || '').replace(/[^A-Za-z0-9 -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  }

  /* The index key: what the rules compute from a handle, so "Knight Tamer",
     "knight-tamer", and "KNIGHT TAMER" all contend for the same name. */
  function handleKey(clean) {
    return clean.toLowerCase().replace(/ /g, '-');
  }

  /* Saving fails for two very different reasons, and telling them apart is the
     difference between "fix your typing" and "the rules are not published yet". */
  function describeError(e) {
    var s = String((e && (e.code || e.message)) || '').toUpperCase();
    if (s.indexOf('TAKEN') > -1) return 'That name is taken. Try another.';
    if (s.indexOf('LOCKED') > -1) {
      return 'You have already changed your name recently. The next change unlocks in '
        + (e.days || 90) + ' day' + ((e.days === 1) ? '' : 's') + '.';
    }
    if (s.indexOf('PERMISSION') > -1) {
      return 'The database refused this write. The security rules may not be published yet.';
    }
    if (s.indexOf('SIGNED OUT') > -1) return 'You are signed out. Sign in and try again.';
    return 'Could not save right now. Please try again.';
  }

  /* Renaming is limited so the chess leaderboard stays recognizable. The first
     48 hours allow three changes, because that is when a new reader notices a
     typo or settles on something better. After that it is one change per 90
     days. The database enforces this; the checks here exist only so the reason
     can be explained before a write is refused. */
  var GRACE_MS = 48 * 60 * 60 * 1000;
  var COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;
  var GRACE_CHANGES = 3;

  function renameStatus() {
    if (!db || !currentUser) return Promise.resolve({ allowed: false, reason: 'signed out' });
    return db.ref('users/' + currentUser.uid + '/meta').once('value').then(function (snap) {
      var m = snap.val() || {};
      if (!m.handle) return { allowed: true, first: true, changes: m.handleChanges || 0 };
      var inGrace = m.createdAt && Date.now() < m.createdAt + GRACE_MS;
      var used = m.handleChanges || 0;
      if (inGrace && used < GRACE_CHANGES) {
        return { allowed: true, changes: used, left: GRACE_CHANGES - used, grace: true };
      }
      var since = Date.now() - (m.handleChangedAt || 0);
      if (!m.handleChangedAt || since >= COOLDOWN_MS) return { allowed: true, changes: used };
      return {
        allowed: false,
        changes: used,
        days: Math.max(1, Math.ceil((COOLDOWN_MS - since) / 86400000))
      };
    });
  }

  function setHandle(name) {
    var clean = cleanHandle(name);
    if (clean.length < 1) return Promise.reject(new Error('empty'));
    if (!db || !currentUser) return Promise.reject(new Error('signed out'));
    if (clean === currentHandle) return Promise.resolve(clean);
    return renameStatus().then(function (st) {
      if (!st.allowed) {
        var e = new Error('locked');
        e.days = st.days;
        throw e;
      }
      var uid = currentUser.uid;
      var key = handleKey(clean);
      var oldKey = currentHandle ? handleKey(currentHandle) : null;
      /* Asking first gives a friendly answer; the rules still decide, so a race
         for the same name ends in a refusal that is reported the same way. */
      return db.ref('handles/' + key).once('value').then(function (snap) {
        var owner = snap.val();
        if (owner && owner !== uid) throw new Error('taken');
        var base = 'users/' + uid + '/meta/';
        var patch = {};
        patch[base + 'handle'] = clean;
        patch[base + 'handleChangedAt'] = Date.now();
        // Counter is append-only in the rules, so send the next value, never a reset.
        if (!st.first) patch[base + 'handleChanges'] = (st.changes || 0) + 1;
        patch['handles/' + key] = uid;
        if (oldKey && oldKey !== key) patch['handles/' + oldKey] = null;
        return db.ref().update(patch).catch(function (e) {
          var code = String((e && (e.code || e.message)) || '').toUpperCase();
          if (code.indexOf('PERMISSION') === -1) throw e;
          // Refused: most likely someone claimed the name between the read and the write.
          return db.ref('handles/' + key).once('value').then(function (again) {
            var now = again.val();
            throw new Error(now && now !== uid ? 'taken' : 'permission denied');
          });
        });
      });
    }).then(function () {
      currentHandle = clean;
      lsSet(HANDLE_KEY, clean);
      lsSet(HANDLE_OWNER_KEY, currentUser.uid);
      ssSet(HANDLE_PULL_PREFIX + currentUser.uid, String(Date.now()));
      ssDel(HANDLE_PULL_ATTEMPT_PREFIX + currentUser.uid);
      emit();
      return clean;
    });
  }

  function sdkReady() {
    return !!(window.firebase && window.firebase.auth && db);
  }

  function popupSignIn(providerId) {
    var auth = window.firebase.auth();
    var provider = providerId === 'github.com'
      ? new window.firebase.auth.GithubAuthProvider()
      : new window.firebase.auth.GoogleAuthProvider();
    // No extra scopes are requested: the default profile is never stored.
    return auth.signInWithPopup(provider).catch(function (err) {
      var code = (err && err.code) || '';
      /* signInWithRedirect is NOT a usable fallback here. Firebase routes it
         through an iframe on the firebaseapp.com auth domain, which Safari
         16.1+, Chrome 115+, and Firefox 109+ block as third-party storage.
         The documented fixes all require serving the auth handler from this
         domain, which GitHub Pages cannot do. So the popup is the only route,
         and a blocked popup has to be reported rather than worked around. */
      if (code === 'auth/popup-blocked') {
        throw new Error('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.');
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/canceled-popup-request') {
        throw new Error('Sign-in was canceled.');
      }
      throw err;
    });
  }

  function signIn(providerId) {
    /* Called straight from the click when the SDK is already in memory. Going
       through a promise first would put the popup outside the user gesture,
       which Safari refuses to open. preloadSDK (on menu open) is what makes
       this the normal path. */
    if (sdkReady()) return popupSignIn(providerId);
    return loadSDK().then(function (ok) {
      if (!ok) throw new Error('Firebase could not load. A content blocker is the usual cause.');
      return popupSignIn(providerId);
    });
  }

  function signOut() {
    var uid = currentUser && currentUser.uid;
    lsDel(SEEN_KEY);
    lsDel(HANDLE_KEY);
    lsDel(HANDLE_OWNER_KEY);
    clearHandlePullMarkers(uid);
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
      p.textContent = 'This is the name shown on the chess leaderboard, so it has to be unique. '
        + 'Your real name is never stored. Letters, numbers, spaces, and dashes, up to 20 characters.';
      // Same rule the leaderboard enforces, so a name that saves here always displays.

      var input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 20;
      input.value = currentHandle || '';
      input.placeholder = 'e.g. knight-tamer';

      var err = document.createElement('div');
      err.className = 'site-auth-err';

      /* Say up front what the reader is spending, so the limit is never a
         surprise discovered by being refused. */
      var quota = document.createElement('p');
      quota.style.cssText = 'margin:8px 0 0;font-size:0.78rem;';
      box.appendChild(quota);
      renameStatus().then(function (st) {
        if (st.first) {
          quota.textContent = 'You can change this 3 times in your first 48 hours, then once every 90 days.';
        } else if (st.grace) {
          quota.textContent = 'Changes left in your first 48 hours: ' + st.left
            + '. After that, once every 90 days.';
        } else if (st.allowed) {
          quota.textContent = 'Changing this now locks it for 90 days.';
        } else {
          quota.textContent = 'Locked for another ' + st.days + ' day' + (st.days === 1 ? '' : 's') + '.';
          save.disabled = true;
        }
      })['catch'](function () {});

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
        if (cleanHandle(input.value).length < 1) {
          err.textContent = 'Enter at least one letter or number.';
          return;
        }
        save.disabled = true;
        err.textContent = '';
        setHandle(input.value).then(close).catch(function (e) {
          save.disabled = false;
          err.textContent = describeError(e);
        });
      };
      cancel.onclick = function () {
        // Safari private browsing throws on setItem, which would trap the modal open.
        try { sessionStorage.setItem(ASKED_KEY, '1'); } catch (e) {}
        close(null);
      };
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

    /* The popover lives on document.body, so clearing the navbar host does not
       touch it. Anything built for the other sign-in state is stale now, which
       also covers signing in or out from a second tab. */
    var open = document.querySelector('.site-auth-menu');
    if (open && open.dataset.authState !== (currentUser ? 'in' : 'out')) {
      if (open.__dismiss) open.__dismiss(); else open.remove();
    }

    host.textContent = '';

    /* One control at every moment. Signed in it carries the reader's name, and
       everything else lives behind it, so the navbar strip stays narrow. */
    if (currentUser) {
      var name = currentHandle || lsGet(HANDLE_KEY) || 'Set name';
      var who = document.createElement('button');
      who.className = 'site-auth-btn site-auth-btn-quiet';
      who.textContent = name;
      who.title = 'Account options';
      who.onclick = function () {
        openMenu(who, [
          { label: 'Change name', onClick: function (ctx) { ctx.close(); askHandle(); } },
          { label: 'Sign out', onClick: function (ctx) { ctx.close(); signOut(); } }
        ]);
      };
      host.appendChild(who);
      /* Only once the read has come back is the absence of a name real. The
         chooser used to open on every page load, because at first paint the
         handle had not arrived yet and looked missing. */
      if (handleLoaded && !currentHandle) askHandleOnce();
      return;
    }

    var btn = document.createElement('button');
    btn.className = 'site-auth-btn';
    btn.textContent = 'Sign in';
    btn.title = 'Sign in to keep your progress across devices';
    btn.onclick = function () {
      /* Warm the SDK on open, so the provider click lands on the synchronous
         path and the popup stays inside the user gesture (Safari requires it). */
      loadSDK();
      openMenu(btn, PROVIDERS.map(function (p) {
        return {
          label: p.note ? p.label + ' (' + p.note + ')' : p.label,
          primary: true,
          onClick: function (ctx) {
            ctx.button.disabled = true;
            signIn(p.id).then(function () {
              ctx.close();          // signed in, so the provider list is spent
            })['catch'](function (e) {
              ctx.button.disabled = false;
              ctx.setError((e && e.message) || 'Sign-in failed. Please try again.');
            });
          }
        };
      }), 'Sign-in keeps your reading position and chess progress across devices. The sign-in provider holds your email address to identify your account. It is never shown on this site, never shared, and nothing else about you is stored.');
    };
    host.appendChild(btn);
  }

  /* Prompt at most once per browser session. Re-opening the modal on every
     page load would be unbearable for someone who chose "Not now". */
  var asked = false;
  function askHandleOnce() {
    if (asked) return;
    try { if (sessionStorage.getItem(ASKED_KEY) === '1') return; } catch (e) {}
    asked = true;
    try { sessionStorage.setItem(ASKED_KEY, '1'); } catch (e) {}
    askHandle();
  }

  /* The popover is attached to the body rather than to the navbar item. Inside
     the navbar it inherited the bar's own foreground and background colors
     (which is why it rendered dark on a light page) and was liable to be
     clipped by the bar's bounds. Anchored to the body it picks up ordinary page
     colors, and a fixed position keeps it beside the button. */
  function openMenu(anchor, items, intro) {
    var existing = document.querySelector('.site-auth-menu');
    if (existing) { existing.remove(); return; }   // second click closes it

    var menu = document.createElement('div');
    menu.className = 'site-auth-menu';
    menu.dataset.authState = currentUser ? 'in' : 'out';

    if (intro) {
      var lead = document.createElement('p');
      lead.textContent = intro;
      menu.appendChild(lead);
    }

    var err = document.createElement('div');
    err.className = 'site-auth-err';
    err.style.display = 'none';

    items.forEach(function (item) {
      var b = document.createElement('button');
      b.className = 'site-auth-btn' + (item.primary ? '' : ' site-auth-btn-quiet');
      b.textContent = item.label;
      b.onclick = function () {
        item.onClick({
          button: b,
          close: dismiss,
          setError: function (msg) { err.textContent = msg; err.style.display = 'block'; }
        });
      };
      menu.appendChild(b);
    });
    menu.appendChild(err);

    document.body.appendChild(menu);

    function place() {
      var r = anchor.getBoundingClientRect();
      var w = menu.offsetWidth;
      var left = Math.min(r.right - w, window.innerWidth - w - 8);
      menu.style.top = (r.bottom + 8) + 'px';
      menu.style.left = Math.max(8, left) + 'px';
    }
    place();

    function dismiss() {
      menu.remove();
      document.removeEventListener('click', away, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', dismiss, true);
    }
    function away(e) {
      if (!menu.contains(e.target) && e.target !== anchor) dismiss();
    }
    // exposed so render() can tear this down properly, listeners and all
    menu.__dismiss = dismiss;
    setTimeout(function () {
      document.addEventListener('click', away, true);
      window.addEventListener('resize', place);
      window.addEventListener('scroll', dismiss, true);
    }, 0);
  }

  function mount() {
    if (document.getElementById('site-auth')) return;
    var host = document.createElement('div');
    host.id = 'site-auth';

    /* The tools strip, appended last so it sits at the far right: after the
       resume pill and the search icon. The right-hand nav list looks tidier on
       a wide screen but lives inside the collapsible section, so below the
       navbar breakpoint it drops onto its own row under the pill. The tools
       strip stays visible at every width. */
    var tools = document.querySelector('.quarto-navbar-tools');
    if (tools) {
      tools.appendChild(host);
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
    firebaseFunctions: function () {
      return loadFunctionsSDK().then(function (ok) {
        if (!ok || !window.firebase || !window.firebase.functions) {
          throw new Error('Firebase functions are unavailable');
        }
        // us-central1 is Firebase Functions' default region. The compat
        // namespace accepts an optional Firebase App here, not a region string.
        return window.firebase.functions();
      });
    },
    publicFirebaseFunctions: function () {
      return loadPublicFunctionsSDK().then(function (ok) {
        if (!ok || !window.firebase || !window.firebase.functions) {
          throw new Error('Firebase functions are unavailable');
        }
        return window.firebase.functions();
      });
    },
    db: function () { return db; },
    ref: function (path) {
      if (!db || !currentUser) return null;
      return db.ref('users/' + currentUser.uid + (path ? '/' + path : ''));
    },
    /* Pages that want the session without forcing a sign-in prompt. Resolves
       after the first auth callback, or immediately when there is no known
       returning-reader session to restore. */
    ready: function () {
      if (currentUser) return Promise.resolve(currentUser);
      if (lsGet(SEEN_KEY) !== '1') return Promise.resolve(null);
      return loadSDK().then(function (ok) {
        if (!ok) throw new Error('Authentication is unavailable');
        return waitForInitialAuthState();
      });
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    mount();
    // Returning readers get the SDK straight away so the navbar shows them signed in.
    if (lsGet(SEEN_KEY) === '1') loadSDK();
  });
})();
