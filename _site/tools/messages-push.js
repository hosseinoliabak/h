/* Standard Web Push is opt-in. No private message text enters a notification. */
(function () {
  'use strict';
  window.MessagePush = { init: function (options) {
    var panel = document.getElementById('msg-notifications'), button = document.getElementById('msg-push-toggle');
    var all = document.getElementById('msg-push-all'), label = document.getElementById('msg-push-status');
    var user = null, generation = 0, busy = false, config = null, registration = null, subscription = null, enabled = false;
    function supported() { return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
    function current(version) { return version === generation && !!user; }
    function draw() { button.disabled = busy || !config; all.disabled = busy || !config; button.textContent = enabled ? 'Turn off on this device' : 'Enable on this device'; }
    function timeout(promise) {
      var timer;
      return Promise.race([promise, new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error('timeout')); }, 15000); })]).finally(function () { clearTimeout(timer); });
    }
    async function load() {
      if (!user || busy) return;
      var version = generation; busy = true; config = null; draw();
      if (!supported()) { label.textContent = 'Push is unavailable here. On iPhone or iPad, add Messages to the Home Screen and open that app. Unread badges still work.'; busy = false; return; }
      try {
        var settings = await options.call({ action: 'push-status' });
        if (!current(version)) return;
        if (typeof settings.publicKey !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(settings.publicKey) || !Array.isArray(settings.devices) || settings.devices.length > 5 || settings.devices.some(function (id) { return !/^[a-f0-9]{64}$/.test(id); })) throw new Error('invalid');
        registration = await timeout(navigator.serviceWorker.register('/tools/messages-sw.js', { scope: '/tools/messages', updateViaCache: 'none' }));
        subscription = await timeout(registration.pushManager.getSubscription());
        if (!current(version)) return;
        var id = subscription ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint)))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('') : null;
        if (!current(version)) return;
        config = settings; enabled = Notification.permission === 'granted' && settings.devices.includes(id);
        label.textContent = enabled ? 'Push is on for this device. Notifications show no private message content.' : 'Push is off for this device. Choose Enable to receive alerts when the site is closed.';
      } catch (_) { if (current(version)) label.textContent = 'Notification settings could not be loaded. Close and reopen this menu to try again.'; }
      finally { if (current(version)) { busy = false; draw(); } }
    }
    panel.addEventListener('toggle', function () { if (panel.open) load(); });
    button.addEventListener('click', async function () {
      if (!user || busy || !config || !registration) return;
      var version = generation, turningOff = enabled, created = null; busy = true; draw();
      // Request permission directly from the click, before any asynchronous work.
      try {
        var permission = turningOff ? Promise.resolve('granted') : Notification.requestPermission();
        if (turningOff) {
          if (subscription) { await options.call({ action: 'push-unsubscribe', endpoint: subscription.endpoint }); await timeout(subscription.unsubscribe()); }
          if (current(version)) { subscription = null; enabled = false; label.textContent = 'Push is off for this device.'; }
          return;
        }
        if (await permission !== 'granted') { if (current(version)) label.textContent = 'Notifications were not allowed. You can change this in your browser settings. Unread badges still work.'; return; }
        if (!current(version)) return;
        if (subscription) { await timeout(subscription.unsubscribe()); subscription = null; }
        var key = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), function (c) { return c.charCodeAt(0); });
        // The active worker may still be installing on a first visit. Wait for
        // this registration, not the global ready promise for another scope.
        if (!registration.active) await timeout(new Promise(function (resolve, reject) {
          var worker = registration.installing || registration.waiting;
          if (!worker) { reject(new Error('worker')); return; }
          function changed() { if (worker.state === 'activated' || worker.state === 'redundant') { worker.removeEventListener('statechange', changed); if (worker.state === 'activated') resolve(); else reject(new Error('worker')); } }
          worker.addEventListener('statechange', changed); changed();
        }));
        var attempt = registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), abandoned = false;
        attempt.then(function (value) { if (abandoned || !current(version)) value.unsubscribe().catch(function () {}); }, function () {});
        try { created = await timeout(attempt); } catch (error) { abandoned = true; throw error; }
        if (!current(version)) { await created.unsubscribe(); return; }
        await options.call({ action: 'push-subscribe', subscription: created.toJSON() });
        if (!current(version)) { await created.unsubscribe(); return; }
        subscription = created; enabled = true; label.textContent = 'Push is on for this device. Notifications show no private message content.';
      } catch (_) {
        if (created) await created.unsubscribe().catch(function () {});
        if (current(version)) label.textContent = turningOff ? 'Push could not be fully turned off. Try again, or block notifications in browser settings.' : 'Push could not be enabled. Check your browser permissions and connection, then try again.';
      } finally { if (current(version)) { busy = false; draw(); } }
    });
    all.addEventListener('click', async function () {
      if (!user || busy || !config) return;
      var version = generation; busy = true; draw();
      try {
        await options.call({ action: 'push-disable-all' });
        if (subscription) await timeout(subscription.unsubscribe());
        if (current(version)) { subscription = null; enabled = false; label.textContent = 'Push is off on all devices for your account.'; }
      } catch (_) { if (current(version)) label.textContent = 'Push settings could not be saved. Try again.'; }
      finally { if (current(version)) { busy = false; draw(); } }
    });
    return { onUser: function (next) {
      var previous = user; user = next; generation++; busy = false; config = null; enabled = false;
      if (previous && (!next || next.uid !== previous.uid) && subscription) subscription.unsubscribe().catch(function () {});
      subscription = null; registration = null; panel.hidden = !next; panel.open = false; label.textContent = ''; draw();
    } };
  } };
}());
