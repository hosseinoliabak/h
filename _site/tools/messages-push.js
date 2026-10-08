/* Standard Web Push is opt-in. No private message text enters a notification. */
(function () {
  'use strict';
  window.MessagePush = { init: function (options) {
    var panel = document.getElementById('msg-notifications'), button = document.getElementById('msg-push-toggle');
    var all = document.getElementById('msg-push-all'), label = document.getElementById('msg-push-status');
    var user = null, generation = 0, busy = false, config = null, registration = null, subscription = null, enabled = false;
    var lastCheck = 0;
    function supported() { return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
    function current(version) { return version === generation && !!user; }
    function draw() { button.disabled = busy || !config; all.disabled = busy || !config; button.textContent = enabled ? 'Turn off on this device' : 'Enable on this device'; }
    function saved(result) { if (!result || result.saved !== true) throw new Error('not saved'); }
    function live(value) { return !!value && (value.expirationTime == null || value.expirationTime > Date.now()); }
    function describe() {
      label.textContent = enabled ? 'Push is on for this device. Notifications show no private message content.' : Notification.permission === 'denied' ? 'Notifications are blocked in your browser settings. Unread badges still work.' : 'Push is off for this device. Choose Enable to receive alerts when the site is closed.';
    }
    function timeout(promise) {
      var timer;
      return Promise.race([promise, new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error('timeout')); }, 15000); })]).finally(function () { clearTimeout(timer); });
    }
    async function readState(version) {
      var settings = await options.call({ action: 'push-status' });
      if (!current(version)) return;
      if (typeof settings.publicKey !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(settings.publicKey) || !Array.isArray(settings.devices) || settings.devices.length > 5 || settings.devices.some(function (id) { return !/^[a-f0-9]{64}$/.test(id); })) throw new Error('invalid');
      var worker = await timeout(navigator.serviceWorker.register('/tools/messages-sw.js', { scope: '/tools/messages', updateViaCache: 'none' }));
      var existing = await timeout(worker.pushManager.getSubscription());
      var id = existing ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(existing.endpoint)))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('') : null;
      if (!current(version)) return;
      registration = worker; subscription = existing; config = settings;
      enabled = Notification.permission === 'granted' && live(existing) && settings.devices.includes(id);
      lastCheck = Date.now(); describe();
    }
    async function load() {
      if (!user || busy) return;
      var version = generation; busy = true; config = null; draw();
      if (!supported()) { label.textContent = 'Push is unavailable here. On iPhone or iPad, add Messages to the Home Screen and open that app. Unread badges still work.'; busy = false; draw(); return; }
      try {
        await readState(version);
      } catch (_) { if (current(version)) label.textContent = 'Notification settings could not be loaded. Close and reopen this menu to try again.'; }
      finally { if (current(version)) { lastCheck = Date.now(); busy = false; draw(); } }
    }
    panel.addEventListener('toggle', function () { if (panel.open) load(); });
    function refresh() { if (!document.hidden && panel.open && Date.now() - lastCheck >= 5000) load(); }
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    // Poll only an open menu, within the shared account request allowance.
    window.setInterval(refresh, 600000);
    button.addEventListener('click', async function () {
      if (!user || busy || !config || !registration) return;
      var version = generation, turningOff = enabled, created = null, enrolling = false, removed = false; busy = true; label.textContent = turningOff ? 'Turning push off…' : 'Enabling push…'; draw();
      // Request permission directly from the click, before any asynchronous work.
      try {
        var permission = turningOff ? Promise.resolve('granted') : Notification.requestPermission();
        if (turningOff) {
          if (subscription) { saved(await options.call({ action: 'push-unsubscribe', endpoint: subscription.endpoint })); if (!current(version)) return; removed = true; enabled = false; await timeout(subscription.unsubscribe()); }
          if (current(version)) { subscription = null; enabled = false; label.textContent = 'Push is off for this device.'; }
          return;
        }
        if (await permission !== 'granted') { if (current(version)) label.textContent = 'Notifications were not allowed. You can change this in your browser settings. Unread badges still work.'; return; }
        if (!current(version)) return;
        // Reuse the browser subscription when repairing server registration.
        // Recreating it on every click can invalidate an already working device.
        var key = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), function (c) { return c.charCodeAt(0); });
        // The active worker may still be installing on a first visit. Wait for
        // this registration, not the global ready promise for another scope.
        if (!registration.active) {
          var worker = registration.installing || registration.waiting, changed;
          if (!worker) throw new Error('worker');
          try { await timeout(new Promise(function (resolve, reject) {
            changed = function () { if (worker.state === 'activated') resolve(); else if (worker.state === 'redundant') reject(new Error('worker')); };
            worker.addEventListener('statechange', changed); changed();
          })); } finally { if (changed) worker.removeEventListener('statechange', changed); }
        }
        if (!current(version)) return;
        var candidate = await timeout(registration.pushManager.getSubscription());
        if (!current(version)) return;
        if (candidate && !live(candidate)) { await timeout(candidate.unsubscribe()); candidate = null; }
        if (!current(version)) return;
        if (!candidate) {
          var attempt = registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), abandoned = false;
          attempt.then(function (value) { if (abandoned || !current(version)) value.unsubscribe().catch(function () {}); }, function () {});
          try { created = candidate = await timeout(attempt); } catch (error) { abandoned = true; throw error; }
        }
        if (!current(version)) { if (created) await created.unsubscribe(); return; }
        subscription = candidate;
        enrolling = true;
        saved(await options.call({ action: 'push-subscribe', subscription: candidate.toJSON() }));
        if (!current(version)) { if (created) await created.unsubscribe(); return; }
        subscription = candidate; enabled = true; lastCheck = Date.now(); describe();
      } catch (_) {
        // A lost save response can follow a committed registration. Recheck
        // before removing a new subscription or showing a stale failure.
        if (current(version) && enrolling) {
          try { await readState(version); if (current(version) && enabled) return; }
          catch (_) { if (current(version)) { config = null; label.textContent = 'Push status could not be confirmed. Reopen this menu to check before trying again.'; return; } }
        }
        if (created) {
          await created.unsubscribe().catch(function () {});
          if (current(version) && subscription === created) { subscription = null; enabled = false; }
        }
        if (current(version)) label.textContent = turningOff ? removed ? 'Push is off for this account on this device. Browser cleanup failed. Block notifications in browser settings if needed.' : 'Push could not be fully turned off. Try again, or block notifications in browser settings.' : 'Push could not be enabled. Check your browser permissions and connection, then try again.';
      } finally { if (current(version)) { busy = false; draw(); } }
    });
    all.addEventListener('click', async function () {
      if (!user || busy || !config) return;
      var version = generation, removed = false; busy = true; label.textContent = 'Turning push off on all devices…'; draw();
      try {
        saved(await options.call({ action: 'push-disable-all' }));
        if (!current(version)) return;
        enabled = false; removed = true;
        if (subscription) await timeout(subscription.unsubscribe());
        if (current(version)) { subscription = null; enabled = false; label.textContent = 'Push is off on all devices for your account.'; }
      } catch (_) { if (current(version)) label.textContent = removed ? 'Push is off on all devices for your account. Browser cleanup failed. Block notifications in browser settings if needed.' : 'Push settings could not be saved. Try again.'; }
      finally { if (current(version)) { busy = false; draw(); } }
    });
    return { onUser: function (next) {
      var previous = user; user = next; generation++; busy = false; config = null; enabled = false; lastCheck = 0;
      if (previous && (!next || next.uid !== previous.uid) && subscription) subscription.unsubscribe().catch(function () {});
      subscription = null; registration = null; panel.hidden = !next; panel.open = false; label.textContent = ''; draw();
    } };
  } };
}());
