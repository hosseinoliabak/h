/* Site-wide identity for H's Notes.
 *
 * Sign-in exists so a reader's progress (reading position, chess training,
 * course completion) follows them between devices. It deliberately gates
 * public notes. The Messages page is a public shell; its private conversation
 * records are fetched only after server-enforced membership authorization.
 *
 * Identity comes from Google or GitHub. The record under users/<uid> holds a self-chosen handle and
 * progress, never the provider's name or email address. The provider's real
 * name is deliberately not read, because it would end up on a public
 * leaderboard. The email address stays with the sign-in provider, which
 * needs it to identify the account; it is never copied into the database.
 * Messages maintains a separate private name profile. Signed-in readers can
 * find an account by its complete sign-in email. Only the site owner can
 * also search a site username or private profile name.
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
 *     A cold call prepares the modules and asks for another click. A warm
 *     call opens the provider popup directly from that click. The navbar
 *     waits for preparation before making provider buttons available.
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
  var accountWatchEpoch = 0;
  var accountWatchOff = null;
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
  var googlePopupAuth = null;
  var googlePopupReady = false;
  var signInEpoch = 0;
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
      var ownsScript = !script;

      function finish(error) {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        window.clearInterval(poll);
        if (script) {
          script.removeEventListener('load', loaded);
          script.removeEventListener('error', failed);
        }
        if (error || !ready()) {
          if (ownsScript && script) script.remove();
          reject(error || new Error('Firebase module did not initialize'));
        }
        else resolve();
      }

      function loaded() { finish(); }
      function failed() { finish(new Error('Firebase module was blocked')); }

      if (!script) {
        script = document.createElement('script');
        script.src = url.href;
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.referrerPolicy = 'no-referrer';
        document.head.appendChild(script);
      }
      script.addEventListener('load', loaded, { once: true });
      script.addEventListener('error', failed, { once: true });
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
      if (!ok) { loading = null; return false; }
      try {
        // The tool pages initialize the same project; reuse their app if present.
        if (!window.firebase.apps.length) {
          window.firebase.initializeApp(CONFIG);
        }
        try { window.firebase.appCheck().activate(RECAPTCHA, true); } catch (e) {}
        db = window.firebase.database();
        watchAuth();
        return prepareGooglePopup().then(function () { return true; }).catch(function () {
          loading = null;
          return false;
        });
      } catch (e) {
        loading = null;
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
      watchAccountStatus(currentUser);
      if (resolveInitialAuthState) {
        resolveInitialAuthState(currentUser);
        resolveInitialAuthState = null;
      }
      emit();
    });
    // Both providers complete through popup promises. Session restoration
    // uses onAuthStateChanged, without starting a cross-origin redirect helper.
  }

  /* Login counts record observed auth_time values, not page refreshes. The
     status stream ends revoked sessions on open pages; server rules enforce
     the same status independently of this cooperative client behavior. */
  function watchAccountStatus(user) {
    accountWatchEpoch += 1;
    var epoch = accountWatchEpoch;
    if (accountWatchOff) accountWatchOff();
    accountWatchOff = null;
    if (!user || !db || typeof user.getIdTokenResult !== 'function') return;
    var uid = user.uid;
    user.getIdTokenResult().then(function (result) {
      if (epoch !== accountWatchEpoch || !currentUser || currentUser.uid !== uid) return;
      var authTime = result.claims && result.claims.auth_time;
      if (!Number.isSafeInteger(authTime)) return;
      var reference = db.ref('site-account-status/' + uid);
      function changed(snapshot) {
        if (epoch !== accountWatchEpoch || !currentUser || currentUser.uid !== uid) return;
        var value = snapshot.val();
        if (value && (value.disabled === true || Number(value.validAfter) > authTime)) signOut().catch(function () {});
      }
      reference.on('value', changed, function () {});
      accountWatchOff = function () { reference.off('value', changed); };
      var marker = 'site-observed-login-' + uid;
      if (Number(lsGet(marker)) >= authTime) return;
      window.siteAuth.firebaseFunctions().then(function (service) {
        if (epoch !== accountWatchEpoch || !currentUser || currentUser.uid !== uid) return;
        return service.httpsCallable('siteAdmin', { timeout: 30000, limitedUseAppCheckTokens: true })({ action: 'track' }).then(function () {
          if (epoch === accountWatchEpoch && currentUser && currentUser.uid === uid) lsSet(marker, String(authTime));
        });
      }).catch(function () {});
    }).catch(function () {});
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
    return !!(window.firebase && window.firebase.auth && db && googlePopupReady);
  }

  /* Keep existing sessions and GitHub's registered callback on the default
     app. Google uses a same-origin popup helper and transfers its credential
     through the documented signInWithCredential API into the default app.
     The helper app has memory-only Auth persistence and is cleared afterward. */
  function prepareGooglePopup() {
    if (googlePopupReady) return Promise.resolve();
    if (!googlePopupAuth) {
      var options = Object.assign({}, CONFIG, { authDomain: 'oliabak.com' });
      var helper = window.firebase.apps.filter(function (app) { return app.name === 'site-google-popup'; })[0];
      if (helper && (helper.options.authDomain !== options.authDomain || helper.options.projectId !== options.projectId)) {
        return Promise.reject(new Error('Unexpected sign-in configuration'));
      }
      helper = helper || window.firebase.initializeApp(options, 'site-google-popup');
      googlePopupAuth = helper.auth();
    }
    return googlePopupAuth.setPersistence(window.firebase.auth.Auth.Persistence.NONE).then(function () {
      googlePopupReady = true;
    });
  }

  function popupSignIn(providerId) {
    var auth = window.firebase.auth();
    var epoch = ++signInEpoch;
    var provider = providerId === 'github.com'
      ? new window.firebase.auth.GithubAuthProvider()
      : new window.firebase.auth.GoogleAuthProvider();
    // No extra scopes are requested. Messages documents its private profile.
    var attempt;
    if (providerId === 'google.com') {
      attempt = googlePopupAuth.signInWithPopup(provider).then(function (result) {
        if (epoch !== signInEpoch) throw new Error('Sign-in was canceled');
        // signInWithPopup on the compatibility SDK returns credential directly.
        // The modular credentialFromResult extractor expects _tokenResponse,
        // which the compatibility UserCredential wrapper does not expose.
        var credential = result && result.credential;
        if (!credential || credential.providerId !== 'google.com') {
          var invalid = new Error('Invalid sign-in response');
          invalid.code = 'auth/invalid-credential';
          throw invalid;
        }
        return auth.signInWithCredential(credential);
      }).finally(function () { return googlePopupAuth.signOut(); });
    } else {
      attempt = auth.signInWithPopup(provider);
    }
    return attempt.catch(function (err) {
      var code = (err && err.code) || '';
      /* The auth helper is on a different origin. A redirect fallback would
         require a same-origin helper and updated provider callbacks first.
         Keep the documented popup flow and report failures visibly. */
      if (code === 'auth/popup-blocked') {
        throw new Error('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.');
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/canceled-popup-request') {
        throw new Error('The sign-in window closed before login finished. Keep it open until you return here, then try again.');
      }
      if (code === 'auth/network-request-failed' || code === 'auth/timeout') {
        throw new Error('The sign-in service could not be reached. Check your connection or content blocker and try again.');
      }
      if (code === 'auth/web-storage-unsupported') {
        throw new Error('Your browser cannot save the sign-in session. Allow site storage and try again in a regular browser tab.');
      }
      if (code === 'auth/account-exists-with-different-credential') {
        throw new Error('This email already uses another sign-in method. Use the method you used previously.');
      }
      if (code === 'auth/user-disabled') {
        throw new Error('This account is disabled. Contact the site owner.');
      }
      if (code === 'auth/unauthorized-domain' || code === 'auth/operation-not-allowed') {
        throw new Error('This sign-in method needs a site configuration fix. Contact the site owner.');
      }
      if (code === 'auth/invalid-credential') {
        throw new Error('Google did not return a usable sign-in credential. Try Google again, or use GitHub.');
      }
      throw new Error('Sign-in did not finish. Try again, or try the other sign-in method.');
    });
  }

  function signIn(providerId) {
    /* Called straight from the click when the SDK is already in memory. Going
       through a promise first would put the popup outside the user gesture,
       which Safari refuses to open. preloadSDK (on menu open) is what makes
       this the normal path. */
    if (sdkReady()) return popupSignIn(providerId);
    return loadSDK().then(function (ok) {
      if (!ok) throw new Error('The sign-in service could not load. Check your connection or content blocker, then try again.');
      /* Loading remote modules can outlive the browser user gesture. Require
         a fresh click instead of opening a popup from this async callback. */
      throw new Error('Sign-in is ready. Tap Google or GitHub again to open the sign-in window.');
    });
  }

  function signOut() {
    signInEpoch += 1;
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
          { label: 'Messages', onClick: function (ctx) { ctx.close(); window.location.assign('/tools/messages.html'); } },
          { label: 'Account administration', onClick: function (ctx) { ctx.close(); window.location.assign('/tools/account-admin.html'); } },
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
      var menu = openMenu(btn, PROVIDERS.map(function (p) {
        return {
          label: p.note ? p.label + ' (' + p.note + ')' : p.label,
          primary: true,
          disabled: !sdkReady(),
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
      }), 'Sign in with an existing Google or GitHub account. Your first successful sign-in creates your site account. Your progress and chosen site username are stored. Signed-in readers who know your complete sign-in email can find you in Messages.');
      if (!menu) return;
      if (!sdkReady()) menu.setStatus('Preparing sign-in. Please wait.');
      loadSDK().then(function (ok) {
        menu.setBusy(false);
        menu.setStatus('');
        if (!ok) menu.setError('The sign-in service could not load. Check your connection or content blocker, then tap a sign-in method to retry.');
      });
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
    err.setAttribute('role', 'alert');
    var status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    var buttons = [];

    function setError(msg) {
      if (!menu.isConnected) return;
      err.textContent = msg;
      err.style.display = msg ? 'block' : 'none';
      place();
    }

    items.forEach(function (item) {
      var b = document.createElement('button');
      b.className = 'site-auth-btn' + (item.primary ? '' : ' site-auth-btn-quiet');
      b.textContent = item.label;
      b.disabled = Boolean(item.disabled);
      buttons.push(b);
      b.onclick = function () {
        setError('');
        item.onClick({
          button: b,
          close: dismiss,
          setError: setError
        });
      };
      menu.appendChild(b);
    });
    menu.append(status, err);

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
      if (!menu.isConnected) return;
      document.addEventListener('click', away, true);
      window.addEventListener('resize', place);
      window.addEventListener('scroll', dismiss, true);
    }, 0);
    return {
      setError: setError,
      setBusy: function (busy) {
        if (!menu.isConnected) return;
        buttons.forEach(function (button) { button.disabled = busy; });
      },
      setStatus: function (message) {
        if (!menu.isConnected) return;
        status.textContent = message;
        status.hidden = !message;
        place();
      }
    };
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
