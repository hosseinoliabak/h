/* Push-only worker. No fetch handler, page cache, credentials, or chat data. */
'use strict';
self.addEventListener('push', function (event) {
  // Ignore payload text and destinations completely. Only the fixed event
  // discriminator is consumed, with no HTML, names, files, or message IDs.
  var value;
  try { if (!event.data || event.data.text().length > 128) return; value = event.data.json(); } catch (_) { return; }
  if (!value || value.v !== 1 || value.type !== 'new-message') return;
  event.waitUntil(self.registration.showNotification('Oliabak · New message', {
    body: 'Open Messages to read it.', tag: 'oliabak-messages', renotify: false,
    icon: '/media/apple-touch-icon.png'
  }));
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = new URL('/tools/messages', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
    var existing = clients.find(function (client) {
      var url; try { url = new URL(client.url); } catch (_) { return false; }
      return url.origin === self.location.origin && ['/tools/messages', '/tools/messages.html'].includes(url.pathname);
    });
    return existing ? existing.focus() : self.clients.openWindow(target);
  }));
});
