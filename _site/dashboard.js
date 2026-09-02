/* Publication, connection, and traffic dashboard for H's Notes.
 *
 * Publication data is generated from first-publication dates in source front
 * matter. Traffic data contains aggregate counters supplied by the quota-limited
 * site metrics function. Every string is inserted through textContent.
 */
(function () {
  'use strict';

  var DATA_URL = '/about/dashboard-data.json';
  var MAX_DATA_BYTES = 7 * 1024 * 1024;
  var MAX_METRIC_PAGES = 20000;
  var METRIC_DAY_MS = 24 * 60 * 60 * 1000;
  var METRIC_FIRST_DAY = '1970-01-01';
  var MAX_METRIC_TIMELINE_DAYS = Math.floor(Date.now() / METRIC_DAY_MS) + 1;
  var MAX_METRIC_YEAR_BUCKETS = new Date().getUTCFullYear() - 1970 + 1;
  var MAX_RESPONSE_DURATION_MS = 15000;
  var MIN_TRAFFIC_TIMELINE_DAYS = 7;
  var MAX_TRAFFIC_TIMELINE_BUCKETS = 64;
  var NEXT_HOP_PROTOCOL_LABELS = new Map([
    ['http/0.9', 'HTTP/0.9'],
    ['http/1.0', 'HTTP/1.0'],
    ['http/1.1', 'HTTP/1.1'],
    ['h2', 'HTTP/2'],
    ['h2c', 'HTTP/2'],
    ['h3', 'HTTP/3']
  ]);
  var CACHE_STATUSES = new Set([
    'HIT', 'MISS', 'EXPIRED', 'STALE', 'BYPASS',
    'REVALIDATED', 'UPDATING', 'DYNAMIC', 'NONE/UNKNOWN'
  ]);
  var CACHE_STATUS_NOTES = new Map([
    ['HIT', 'Served from the Cloudflare cache'],
    ['MISS', 'Fetched before a cache entry was available'],
    ['EXPIRED', 'Expired cache content was refreshed'],
    ['STALE', 'Stale cache content was served'],
    ['BYPASS', 'The response bypassed CDN caching'],
    ['REVALIDATED', 'Cached content was revalidated'],
    ['UPDATING', 'Cached content was served while refreshing'],
    ['DYNAMIC', 'This JSON response is not eligible for CDN caching'],
    ['NONE/UNKNOWN', 'No CDN cache decision was applied']
  ]);
  var edgeConnectionSettled = false;
  /* Quarto has no native remote-deployment timestamp. This exact public API
   * endpoint supplies the latest commit that changed deployable site output.
   */
  var UPDATE_API_URL = 'https://api.github.com/repos/hosseinoliabak/h/commits?path=_site&per_page=1';
  var UPDATE_API_ORIGIN = 'https://api.github.com';
  var UPDATE_API_PATH = '/repos/hosseinoliabak/h/commits';
  var MAX_UPDATE_BYTES = 256 * 1024;
  var SUBJECTS = new Set([
    'Artificial Intelligence', 'Cybersecurity', 'Deep Learning',
    'Machine Learning', 'Mathematics', 'Networking', 'Other'
  ]);
  var numberFormat = new Intl.NumberFormat();
  var decimalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  var dateFormat = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
  var monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
  var monthYearFormat = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'long', timeZone: 'UTC'
  });
  var updateDayFormat = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  });
  var updateTimeFormat = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });
  var trafficTimelineState = null;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function validAccountHandle(value) {
    return typeof value === 'string' && /^[A-Za-z0-9 -]{1,20}$/.test(value) ? value : null;
  }

  function renderAccountStatus(user) {
    var badge = document.getElementById('account-status-badge');
    var message = document.getElementById('account-status-message');
    if (!badge || !message) return;
    badge.classList.add('dashboard-status-ready');
    if (!user) {
      badge.textContent = 'Signed out';
      message.textContent = 'You are not signed in. This public dashboard is fully available. Sign in from the navigation bar only if you want your reading position and chess progress to sync across devices.';
      return;
    }
    var handle = window.siteAuth && typeof window.siteAuth.handle === 'function'
      ? validAccountHandle(window.siteAuth.handle())
      : null;
    badge.textContent = 'Signed in';
    message.textContent = handle
      ? 'Signed in as ' + handle + '. This public dashboard is fully available, and your reading position and chess progress can sync across devices.'
      : 'You are signed in. This public dashboard is fully available, and your reading position and chess progress can sync across devices.';
  }

  function renderAccountStatusUnavailable() {
    var badge = document.getElementById('account-status-badge');
    var message = document.getElementById('account-status-message');
    if (!badge || !message) return;
    badge.classList.remove('dashboard-status-ready');
    badge.textContent = 'Unavailable';
    message.textContent = 'Account status is unavailable. This public dashboard remains fully usable.';
  }

  function initializeAccountStatus() {
    if (!window.siteAuth || typeof window.siteAuth.ready !== 'function'
        || typeof window.siteAuth.onChange !== 'function') {
      renderAccountStatusUnavailable();
      return;
    }
    window.siteAuth.ready().then(function () {
      window.siteAuth.onChange(renderAccountStatus);
    }).catch(renderAccountStatusUnavailable);
  }

  function utcDate(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var value = new Date(iso + 'T00:00:00Z');
    return Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== iso ? null : value;
  }

  function isoDate(value) {
    return value.toISOString().slice(0, 10);
  }

  function addUtcDays(value, amount) {
    return new Date(Date.UTC(
      value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + amount
    ));
  }

  function utcDayDistance(first, second) {
    return Math.round((second.getTime() - first.getTime()) / METRIC_DAY_MS);
  }

  function validCleanPagePath(value) {
    return typeof value === 'string'
      && value.length <= 320
      && /^\/(?:[A-Za-z0-9_-]+\/)*(?:[A-Za-z0-9_-]+)?$/.test(value)
      && !value.includes('//')
      && !value.includes('..');
  }

  function validMetricPath(value) {
    return typeof value === 'string'
      && value.length <= 320
      && (value === '/' || /^\/(?:[A-Za-z0-9_-]+\/)*(?:[A-Za-z0-9_-]+\.html)?$/.test(value))
      && !value.includes('//')
      && !value.includes('..');
  }

  function cleanMetricPath(value) {
    if (value === '/index.html') return '/';
    if (value.endsWith('/index.html')) return value.slice(0, -'index.html'.length);
    if (value.endsWith('.html')) return value.slice(0, -'.html'.length);
    return value;
  }

  function validatePublicationData(value) {
    if (!value || value.schemaVersion !== 1 || !utcDate(value.generatedOn)
        || !Number.isSafeInteger(value.metricPageCount) || value.metricPageCount < 1 || value.metricPageCount > MAX_METRIC_PAGES
        || !Array.isArray(value.articles) || value.articles.length > MAX_METRIC_PAGES) {
      throw new Error('Publication data has an unsupported shape');
    }
    var seen = new Set();
    var articles = value.articles.map(function (item) {
      if (!item || !utcDate(item.date) || typeof item.title !== 'string'
          || item.title.length < 1 || item.title.length > 240
          || !validCleanPagePath(item.href) || !SUBJECTS.has(item.subject)) {
        throw new Error('Publication data contains an invalid article');
      }
      var identity = item.href + '\n' + item.date;
      if (seen.has(identity)) throw new Error('Publication data contains a duplicate article');
      seen.add(identity);
      return { date: item.date, title: item.title, href: item.href, subject: item.subject };
    });
    articles.sort(function (a, b) {
      return b.date.localeCompare(a.date) || a.title.localeCompare(b.title);
    });
    return { generatedOn: value.generatedOn, metricPageCount: value.metricPageCount, articles: articles };
  }

  function readBoundedBody(response, maximum) {
    var announced = Number(response.headers.get('content-length') || 0);
    if (announced > maximum) return Promise.reject(new Error('Publication data is too large'));
    if (!response.body || !response.body.getReader) {
      return response.arrayBuffer().then(function (buffer) {
        if (buffer.byteLength > maximum) throw new Error('Publication data is too large');
        return {
          text: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
          bytes: buffer.byteLength
        };
      });
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder('utf-8', { fatal: true });
    var total = 0;
    var text = '';
    function next() {
      return reader.read().then(function (part) {
        if (part.done) return { text: text + decoder.decode(), bytes: total };
        total += part.value.byteLength;
        if (total > maximum) {
          reader.cancel();
          throw new Error('Publication data is too large');
        }
        text += decoder.decode(part.value, { stream: true });
        return next();
      });
    }
    return next();
  }

  function parseDeliveryHeaders(headers) {
    var delivery = { colo: null, cacheStatus: null };
    if (!headers || typeof headers.get !== 'function') return delivery;
    try {
      /* Quarto does not expose per-request CDN response metadata. This narrow
       * parser reads only validated values from the existing data request.
       */
      var rayMatch = /^[0-9a-f]{8,64}-([A-Z]{3})$/.exec(headers.get('cf-ray') || '');
      if (rayMatch) delivery.colo = rayMatch[1];
      var cacheStatus = headers.get('cf-cache-status');
      if (CACHE_STATUSES.has(cacheStatus)) delivery.cacheStatus = cacheStatus;
      return delivery;
    } catch (error) {
      return { colo: null, cacheStatus: null };
    }
  }

  function readResourceTiming(url, elapsed) {
    var durationMs = Number.isFinite(elapsed) && elapsed > 0 && elapsed <= MAX_RESPONSE_DURATION_MS
      ? elapsed
      : null;
    var httpVersion = null;
    if (!window.performance || typeof window.performance.getEntriesByName !== 'function') {
      return { durationMs: durationMs, httpVersion: httpVersion };
    }
    try {
      var entries = window.performance.getEntriesByName(url, 'resource');
      var entry = entries.length ? entries[entries.length - 1] : null;
      if (!entry) return { durationMs: durationMs, httpVersion: httpVersion };
      if (Number.isFinite(entry.duration) && entry.duration > 0
          && entry.duration <= MAX_RESPONSE_DURATION_MS) {
        durationMs = entry.duration;
      }
      if (NEXT_HOP_PROTOCOL_LABELS.has(entry.nextHopProtocol)) {
        httpVersion = NEXT_HOP_PROTOCOL_LABELS.get(entry.nextHopProtocol);
      }
      return { durationMs: durationMs, httpVersion: httpVersion };
    } catch (error) {
      return { durationMs: durationMs, httpVersion: httpVersion };
    }
  }

  function loadPublicationData() {
    var url = new URL(DATA_URL, window.location.href);
    if (url.origin !== window.location.origin) return Promise.reject(new Error('Publication data origin is not allowed'));
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, 10000);
    var startedAt = window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : null;
    return window.fetch(url.href, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    }).then(function (response) {
      if (!response.ok) throw new Error('Publication data request failed');
      var type = String(response.headers.get('content-type') || '').toLowerCase();
      if (type.indexOf('application/json') === -1 && type.indexOf('text/plain') === -1) {
        throw new Error('Publication data type is not supported');
      }
      return readBoundedBody(response, MAX_DATA_BYTES).then(function (body) {
        var data = validatePublicationData(JSON.parse(body.text));
        var finishedAt = window.performance && typeof window.performance.now === 'function'
          ? window.performance.now()
          : null;
        var elapsed = startedAt !== null && finishedAt !== null ? finishedAt - startedAt : null;
        var delivery = parseDeliveryHeaders(response.headers);
        var timing = readResourceTiming(url.href, elapsed);
        delivery.durationMs = timing.durationMs;
        delivery.httpVersion = timing.httpVersion;
        delivery.bodyBytes = body.bytes;
        renderEdgeConnection(delivery);
        return data;
      });
    }).finally(function () {
      window.clearTimeout(timer);
    });
  }

  function updateApiUrl() {
    var url = new URL(UPDATE_API_URL);
    if (url.origin !== UPDATE_API_ORIGIN || url.pathname !== UPDATE_API_PATH
        || url.searchParams.get('path') !== '_site' || url.searchParams.get('per_page') !== '1'
        || Array.from(url.searchParams).length !== 2) {
      throw new Error('Website update endpoint is not allowed');
    }
    return url;
  }

  function validateWebsiteUpdate(value) {
    if (!Array.isArray(value) || value.length !== 1) {
      throw new Error('Website update data has an unsupported shape');
    }
    var item = value[0];
    var timestamp = item && item.commit && item.commit.committer && item.commit.committer.date;
    if (!item || typeof item.sha !== 'string' || !/^[0-9a-f]{40}$/.test(item.sha)
        || typeof timestamp !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)) {
      throw new Error('Website update data is invalid');
    }
    var date = new Date(timestamp);
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2020
        || date.getTime() > Date.now() + 300000) {
      throw new Error('Website update time is invalid');
    }
    return date;
  }

  function loadWebsiteUpdate() {
    var url;
    try {
      url = updateApiUrl();
    } catch (error) {
      return Promise.reject(error);
    }
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, 8000);
    return window.fetch(url.href, {
      credentials: 'omit',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10'
      },
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    }).then(function (response) {
      if (!response.ok) throw new Error('Website update request failed');
      var type = String(response.headers.get('content-type') || '').toLowerCase();
      if (type.indexOf('application/json') === -1) {
        throw new Error('Website update data type is not supported');
      }
      return readBoundedBody(response, MAX_UPDATE_BYTES);
    }).then(function (body) {
      return validateWebsiteUpdate(JSON.parse(body.text));
    }).finally(function () {
      window.clearTimeout(timer);
    });
  }

  function groupBy(items, keyFunction) {
    var grouped = new Map();
    items.forEach(function (item) {
      var key = keyFunction(item);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    });
    return grouped;
  }

  function statCard(value, label, note) {
    var card = element('article', 'dashboard-stat-card');
    card.appendChild(element('strong', 'dashboard-stat-value', value));
    card.appendChild(element('span', 'dashboard-stat-label', label));
    if (note) card.appendChild(element('small', 'dashboard-stat-note', note));
    return card;
  }

  function formatDuration(milliseconds) {
    if (milliseconds < 1) return '<1 ms';
    return numberFormat.format(Math.round(milliseconds)) + ' ms';
  }

  function formatDataSize(bytes) {
    if (bytes < 1000) return numberFormat.format(bytes) + ' B';
    if (bytes < 1000000) return decimalFormat.format(bytes / 1000) + ' KB';
    return decimalFormat.format(bytes / 1000000) + ' MB';
  }

  function renderEdgeConnection(connection) {
    var status = document.getElementById('edge-connection-status');
    var host = document.getElementById('edge-connection-stats');
    if (!status || !host) return;
    edgeConnectionSettled = true;
    var hasColo = !!connection.colo;
    var hasDuration = Number.isFinite(connection.durationMs)
      && connection.durationMs > 0 && connection.durationMs <= MAX_RESPONSE_DURATION_MS;
    var hasHttp = Array.from(NEXT_HOP_PROTOCOL_LABELS.values()).indexOf(connection.httpVersion) !== -1;
    var hasBodySize = Number.isSafeInteger(connection.bodyBytes)
      && connection.bodyBytes >= 0 && connection.bodyBytes <= MAX_DATA_BYTES;
    var hasCache = CACHE_STATUSES.has(connection.cacheStatus);
    var cards = [];
    if (hasColo) {
      cards.push(statCard(
        connection.colo,
        'Cloudflare data center',
        'Code reported for this dashboard request'
      ));
    }
    if (hasDuration) {
      cards.push(statCard(
        formatDuration(connection.durationMs),
        'Data response',
        'Full publication-data fetch in this browser'
      ));
    }
    if (hasHttp) {
      cards.push(statCard(
        connection.httpVersion,
        'HTTP connection',
        'Protocol used for the data request'
      ));
    }
    if (hasBodySize) {
      cards.push(statCard(
        formatDataSize(connection.bodyBytes),
        'Data payload',
        'Publication metadata used by this dashboard'
      ));
    }
    if (hasCache) {
      cards.push(statCard(
        connection.cacheStatus,
        'CDN cache decision',
        CACHE_STATUS_NOTES.get(connection.cacheStatus)
      ));
    }
    status.textContent = 'Live';
    status.classList.add('dashboard-status-ready');
    host.replaceChildren.apply(host, cards);
  }

  function renderEdgeConnectionUnavailable() {
    if (edgeConnectionSettled) return;
    var status = document.getElementById('edge-connection-status');
    var host = document.getElementById('edge-connection-stats');
    edgeConnectionSettled = true;
    if (status) {
      status.textContent = 'Not measured';
      status.classList.remove('dashboard-status-ready');
    }
    if (host) {
      host.replaceChildren(element('p', 'dashboard-empty', 'Connection measurements need a successful dashboard data request.'));
    }
  }

  function renderPublicationStats(data) {
    var host = document.getElementById('publication-stats');
    var today = utcDate(data.generatedOn);
    var currentYear = today.getUTCFullYear();
    var byDate = groupBy(data.articles, function (item) { return item.date; });
    var thisYear = data.articles.filter(function (item) { return item.date.slice(0, 4) === String(currentYear); }).length;
    var first = data.articles.length ? data.articles[data.articles.length - 1].date : null;
    var subjects = new Set(data.articles.map(function (item) { return item.subject; }));
    var updateCard = statCard('Checking', 'Last website update', 'Live publication status');
    updateCard.id = 'website-update-stat';
    updateCard.setAttribute('aria-live', 'polite');
    host.replaceChildren(
      updateCard,
      statCard(numberFormat.format(data.articles.length), 'Published articles', 'Original publication dates'),
      statCard(numberFormat.format(thisYear), 'Published in ' + currentYear, 'Through ' + dateFormat.format(today)),
      statCard(numberFormat.format(byDate.size), 'Active publishing days', 'Days with at least one release'),
      statCard(numberFormat.format(subjects.size), 'Subjects', first ? 'Publishing since ' + dateFormat.format(utcDate(first)) : 'No publications yet')
    );
  }

  function renderWebsiteUpdate(date) {
    var host = document.getElementById('website-update-stat');
    if (!host) return;
    var value = element('strong', 'dashboard-stat-value dashboard-stat-value-date');
    var dayText = updateDayFormat.format(date);
    var timeText = updateTimeFormat.format(date);
    var time = element('time', 'dashboard-update-timestamp');
    time.dateTime = date.toISOString();
    time.setAttribute('aria-label', dayText + ', ' + timeText);
    time.append(
      element('span', 'dashboard-update-date', dayText),
      element('span', 'dashboard-update-time', timeText)
    );
    value.appendChild(time);
    host.replaceChildren(
      value,
      element('span', 'dashboard-stat-label', 'Last website update'),
      element('small', 'dashboard-stat-note', 'Live publication status')
    );
  }

  function renderWebsiteUpdateUnavailable() {
    var host = document.getElementById('website-update-stat');
    if (!host) return;
    host.replaceChildren(
      element('strong', 'dashboard-stat-value dashboard-stat-value-date', 'Unavailable'),
      element('span', 'dashboard-stat-label', 'Last website update'),
      element('small', 'dashboard-stat-note', 'The latest publication time could not be verified')
    );
  }

  function levelFor(count) {
    if (count < 1) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 2;
    if (count <= 6) return 3;
    return 4;
  }

  function describeDay(date, articles) {
    var count = articles.length;
    return dateFormat.format(date) + '. ' + numberFormat.format(count) + ' article' + (count === 1 ? '' : 's') + ' published.';
  }

  function showDateDetail(date, articles) {
    var host = document.getElementById('publication-date-detail');
    var heading = element('h3', '', dateFormat.format(date));
    var list = element('ul', 'dashboard-date-list');
    articles.forEach(function (article) {
      var item = element('li');
      var link = element('a', '', article.title);
      link.href = article.href;
      item.appendChild(link);
      list.appendChild(item);
    });
    host.replaceChildren(heading, list);
  }

  function renderCalendar(year, articles) {
    var host = document.getElementById('publication-calendar');
    var summary = document.getElementById('calendar-summary');
    var details = document.getElementById('publication-date-detail');
    var byDate = groupBy(articles.filter(function (item) {
      return item.date.slice(0, 4) === String(year);
    }), function (item) { return item.date; });
    var yearCount = 0;
    byDate.forEach(function (items) { yearCount += items.length; });
    summary.textContent = numberFormat.format(yearCount) + ' article' + (yearCount === 1 ? '' : 's')
      + ' published across ' + numberFormat.format(byDate.size) + ' day' + (byDate.size === 1 ? '' : 's') + ' in ' + year + '.';

    var january = new Date(Date.UTC(year, 0, 1));
    var december = new Date(Date.UTC(year, 11, 31));
    var start = new Date(january);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    var end = new Date(december);
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
    var weeks = Math.round((end - start) / 604800000) + 1;

    var monthRow = element('div', 'dashboard-month-row');
    monthRow.style.gridTemplateColumns = 'repeat(' + weeks + ', var(--dashboard-day-size))';
    for (var month = 0; month < 12; month += 1) {
      var first = new Date(Date.UTC(year, month, 1));
      var week = Math.floor((first - start) / 604800000) + 1;
      var label = element('span', '', monthFormat.format(first));
      label.style.gridColumnStart = String(week);
      monthRow.appendChild(label);
    }

    var labels = element('div', 'dashboard-weekday-labels');
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (day, index) {
      labels.appendChild(element('span', index % 2 ? '' : 'dashboard-weekday-muted', index === 1 || index === 3 || index === 5 ? day : ''));
    });
    var grid = element('div', 'dashboard-day-grid');
    grid.style.gridTemplateColumns = 'repeat(' + weeks + ', var(--dashboard-day-size))';

    for (var cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      var iso = isoDate(cursor);
      var dayArticles = byDate.get(iso) || [];
      var inYear = cursor.getUTCFullYear() === year;
      var day;
      if (inYear && dayArticles.length) {
        day = element('button', 'dashboard-day dashboard-level-' + levelFor(dayArticles.length));
        day.type = 'button';
        day.setAttribute('aria-label', describeDay(cursor, dayArticles));
        day.title = describeDay(cursor, dayArticles);
        (function (selectedDate, selectedArticles) {
          day.addEventListener('click', function () { showDateDetail(selectedDate, selectedArticles); });
        })(new Date(cursor), dayArticles);
      } else {
        day = element('span', 'dashboard-day dashboard-level-0' + (inYear ? '' : ' dashboard-day-outside'));
        if (inYear) {
          day.title = dateFormat.format(cursor) + '. No articles published.';
        } else {
          day.setAttribute('aria-hidden', 'true');
        }
      }
      grid.appendChild(day);
    }

    var body = element('div', 'dashboard-calendar-body');
    body.append(labels, grid);
    host.replaceChildren(monthRow, body);
    details.textContent = byDate.size ? 'Select a filled day to see the articles published on that date.' : 'No articles were published in this year.';
  }

  function renderYearControl(data) {
    var select = document.getElementById('dashboard-year');
    var years = Array.from(new Set(data.articles.map(function (item) { return Number(item.date.slice(0, 4)); })))
      .sort(function (a, b) { return b - a; });
    var current = Number(data.generatedOn.slice(0, 4));
    if (years.indexOf(current) === -1) years.unshift(current);
    years.forEach(function (year) {
      var option = element('option', '', String(year));
      option.value = String(year);
      select.appendChild(option);
    });
    select.value = String(years[0]);
    renderCalendar(years[0], data.articles);
    select.addEventListener('change', function () {
      renderCalendar(Number(select.value), data.articles);
    });
  }

  function renderBarList(hostId, entries, formatter) {
    var host = document.getElementById(hostId);
    var maximum = Math.max.apply(null, entries.map(function (entry) { return entry.count; }).concat([1]));
    var list = element('div', 'dashboard-bar-list');
    entries.forEach(function (entry) {
      var row = element('div', 'dashboard-bar-row');
      var label = element('span', 'dashboard-bar-label', entry.label);
      var track = element('span', 'dashboard-bar-track');
      var fill = element('span', 'dashboard-bar-fill');
      fill.style.setProperty('--dashboard-bar-width', Math.max(2, entry.count / maximum * 100).toFixed(2) + '%');
      track.appendChild(fill);
      var count = element('strong', 'dashboard-bar-count', formatter ? formatter(entry.count) : numberFormat.format(entry.count));
      row.append(label, track, count);
      list.appendChild(row);
    });
    host.replaceChildren(list);
  }

  function renderBreakdowns(data) {
    var years = groupBy(data.articles, function (item) { return item.date.slice(0, 4); });
    var yearEntries = Array.from(years, function (entry) { return { label: entry[0], count: entry[1].length }; })
      .sort(function (a, b) { return b.label.localeCompare(a.label); });
    renderBarList('yearly-output', yearEntries);

    var subjects = groupBy(data.articles, function (item) { return item.subject; });
    var subjectEntries = Array.from(subjects, function (entry) { return { label: entry[0], count: entry[1].length }; })
      .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
    renderBarList('subject-coverage', subjectEntries);
  }

  function renderRecent(data) {
    var host = document.getElementById('recent-publications');
    var fragment = document.createDocumentFragment();
    data.articles.slice(0, 10).forEach(function (article) {
      var item = element('li');
      var link = element('a', 'dashboard-article-title', article.title);
      link.href = article.href;
      var meta = element('span', 'dashboard-article-meta', dateFormat.format(utcDate(article.date)) + ' · ' + article.subject);
      item.append(link, meta);
      fragment.appendChild(item);
    });
    host.replaceChildren(fragment);
  }

  function validateTraffic(value) {
    if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.totalViews) || value.totalViews < 0
        || !Number.isSafeInteger(value.last30Days) || value.last30Days < 0
        || !Number.isSafeInteger(value.measuredPages) || value.measuredPages < 0 || value.measuredPages > MAX_METRIC_PAGES
        || !Array.isArray(value.daily) || value.daily.length > 31
        || (value.timeline !== undefined
          && (!Array.isArray(value.timeline) || value.timeline.length > MAX_METRIC_TIMELINE_DAYS))
        || (value.timelineStartsOn !== undefined && value.timelineStartsOn !== null
          && !utcDate(value.timelineStartsOn))
        || (value.yearly !== undefined
          && (!Array.isArray(value.yearly) || value.yearly.length > MAX_METRIC_YEAR_BUCKETS))
        || !Array.isArray(value.topPages) || value.topPages.length > 20) {
      throw new Error('Traffic data has an unsupported shape');
    }
    function validateSeries(source) {
      var seen = new Set();
      var series = source.map(function (item) {
        if (!item || !utcDate(item.date) || seen.has(item.date)
            || !Number.isSafeInteger(item.views) || item.views < 0) {
          throw new Error('Traffic day is invalid');
        }
        seen.add(item.date);
        return { date: item.date, views: item.views };
      });
      series.sort(function (a, b) { return a.date.localeCompare(b.date); });
      return series;
    }
    var daily = validateSeries(value.daily);
    var hasTimeline = Array.isArray(value.timeline);
    var timeline = hasTimeline ? validateSeries(value.timeline) : daily.slice();
    var hasYearly = Array.isArray(value.yearly);
    var yearly;
    if (hasYearly) {
      var seenYears = new Set();
      yearly = value.yearly.map(function (item) {
        if (!item || typeof item.year !== 'string' || !/^\d{4}$/.test(item.year)
            || Number(item.year) < 1970 || seenYears.has(item.year)
            || !Number.isSafeInteger(item.views) || item.views < 0) {
          throw new Error('Traffic year is invalid');
        }
        seenYears.add(item.year);
        return { year: item.year, views: item.views };
      });
      yearly.sort(function (a, b) { return a.year.localeCompare(b.year); });
    } else {
      var yearlyMap = new Map();
      timeline.forEach(function (day) {
        var year = day.date.slice(0, 4);
        var combined = (yearlyMap.get(year) || 0) + day.views;
        yearlyMap.set(year, Number.isSafeInteger(combined) ? combined : Number.MAX_SAFE_INTEGER);
      });
      yearly = Array.from(yearlyMap, function (entry) {
        return { year: entry[0], views: entry[1] };
      }).sort(function (a, b) { return a.year.localeCompare(b.year); });
    }
    var topPages = value.topPages.map(function (item) {
      if (!item || !validMetricPath(item.path) || typeof item.title !== 'string' || item.title.length < 1 || item.title.length > 180
          || !Number.isSafeInteger(item.views) || item.views < 1) throw new Error('Traffic page is invalid');
      return { path: cleanMetricPath(item.path), title: item.title, views: item.views };
    });
    var collectingSince = value.collectingSince && utcDate(value.collectingSince)
      ? value.collectingSince
      : null;
    var fallbackTimelineStart = timeline.length ? timeline[0].date : null;
    if (collectingSince && (!fallbackTimelineStart || collectingSince < fallbackTimelineStart)) {
      fallbackTimelineStart = collectingSince;
    }
    var timelineStartsOn = hasTimeline
      ? (value.timelineStartsOn || collectingSince || fallbackTimelineStart)
      : fallbackTimelineStart;
    var snapshotEndsOn = daily.length
      ? daily[daily.length - 1].date
      : (timeline.length ? timeline[timeline.length - 1].date : isoDate(new Date()));
    var maximumTimelinePoints = timelineStartsOn
      ? utcDayDistance(utcDate(timelineStartsOn), utcDate(snapshotEndsOn)) + 1
      : MAX_METRIC_TIMELINE_DAYS;
    var maximumYearBuckets = Number(snapshotEndsOn.slice(0, 4)) - 1970 + 1;
    if ((timelineStartsOn && (timelineStartsOn < METRIC_FIRST_DAY || timelineStartsOn > snapshotEndsOn))
        || timeline.length > maximumTimelinePoints
        || timeline.some(function (day) {
          return day.date > snapshotEndsOn || (timelineStartsOn && day.date < timelineStartsOn);
        })
        || yearly.length > maximumYearBuckets
        || yearly.some(function (year) { return year.year > snapshotEndsOn.slice(0, 4); })) {
      throw new Error('Traffic timeline dates are inconsistent');
    }
    return {
      totalViews: value.totalViews,
      last30Days: value.last30Days,
      measuredPages: value.measuredPages,
      collectingSince: collectingSince,
      daily: daily,
      yearly: yearly,
      timeline: timeline,
      timelineStartsOn: timelineStartsOn,
      snapshotEndsOn: snapshotEndsOn,
      topPages: topPages
    };
  }

  function clampTrafficStart(state, startOffset, spanDays) {
    return Math.max(0, Math.min(Math.round(startOffset), state.totalDays - spanDays));
  }

  function trafficWindowLabel(state, bucketDays) {
    var scope = state.spanDays === state.totalDays
      ? 'All history'
      : numberFormat.format(state.spanDays) + ' days';
    var resolution = bucketDays === 1
      ? 'daily totals'
      : numberFormat.format(bucketDays) + '-day totals';
    return scope + ' · ' + resolution;
  }

  function trafficBuckets(state) {
    var width = state.viewport.clientWidth || 960;
    var targetCount = Math.max(8, Math.min(
      MAX_TRAFFIC_TIMELINE_BUCKETS,
      Math.floor(width / 36)
    ));
    var bucketDays = Math.max(1, Math.ceil(state.spanDays / targetCount));
    var bucketCount = Math.ceil(state.spanDays / bucketDays);
    var tickEvery = Math.max(1, Math.ceil(bucketCount / 8));
    var buckets = [];
    for (var index = 0; index < bucketCount; index += 1) {
      var startOffset = state.startOffset + index * bucketDays;
      var endOffset = Math.min(
        state.startOffset + state.spanDays - 1,
        startOffset + bucketDays - 1
      );
      var start = addUtcDays(state.startsOn, startOffset);
      var end = addUtcDays(state.startsOn, endOffset);
      var label = startOffset === endOffset
        ? dateFormat.format(start)
        : dateFormat.format(start) + ' to ' + dateFormat.format(end);
      var tick = '';
      if (index % tickEvery === 0 || index === bucketCount - 1) {
        if (width < 480 && state.spanDays > 60) tick = "'" + String(start.getUTCFullYear()).slice(-2);
        else if (state.spanDays > 12 * 365) tick = String(start.getUTCFullYear());
        else if (state.spanDays > 60) tick = monthFormat.format(start) + ' ' + start.getUTCFullYear();
        else tick = monthFormat.format(start) + ' ' + start.getUTCDate();
      }
      buckets.push({
        end: end,
        label: label,
        start: start,
        tick: tick,
        views: state.prefixViews[endOffset + 1] - state.prefixViews[startOffset]
      });
    }
    return { bucketDays: bucketDays, buckets: buckets };
  }

  function resetTrafficTimeline(message) {
    if (trafficTimelineState && trafficTimelineState.resizeHandler) {
      window.removeEventListener('resize', trafficTimelineState.resizeHandler);
    }
    trafficTimelineState = null;
    ['traffic-zoom-out', 'traffic-zoom-in', 'traffic-all', 'traffic-latest'].forEach(function (id) {
      document.getElementById(id).disabled = true;
    });
    document.getElementById('traffic-zoom-label').textContent = 'All history';
    document.getElementById('traffic-range').textContent = message;
    document.getElementById('traffic-detail').textContent = '';
    document.getElementById('traffic-trend').replaceChildren();
  }

  function renderTrafficTimeline() {
    var state = trafficTimelineState;
    if (!state || !state.startsOn) {
      resetTrafficTimeline('No traffic history has been recorded yet.');
      document.getElementById('traffic-trend').replaceChildren(
        element('p', 'dashboard-empty', 'The timeline will appear after the first counted page view.')
      );
      return;
    }
    var result = trafficBuckets(state);
    var buckets = result.buckets;
    var maximum = Math.max.apply(null, buckets.map(function (bucket) {
      return bucket.views;
    }).concat([1]));
    var total = buckets.reduce(function (sum, bucket) {
      return sum + bucket.views;
    }, 0);
    var buttons = [];
    var fragment = document.createDocumentFragment();
    var detail = document.getElementById('traffic-detail');

    function selectBucket(index, moveFocus) {
      buttons.forEach(function (button, buttonIndex) {
        var selected = buttonIndex === index;
        button.tabIndex = selected ? 0 : -1;
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        button.classList.toggle('dashboard-timeline-selected', selected);
      });
      var bucket = buckets[index];
      detail.textContent = bucket.label + '. ' + numberFormat.format(bucket.views) + ' page view'
        + (bucket.views === 1 ? '' : 's') + '.';
      if (moveFocus) buttons[index].focus();
    }

    buckets.forEach(function (bucket, index) {
      var button = element('button', 'dashboard-timeline-bucket');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      var sentence = bucket.label + '. ' + numberFormat.format(bucket.views) + ' page view'
        + (bucket.views === 1 ? '' : 's') + '.';
      button.setAttribute('aria-label', sentence);
      button.title = sentence;
      var plot = element('span', 'dashboard-timeline-bucket-plot');
      var bar = element('span', 'dashboard-timeline-bar');
      bar.style.setProperty('--dashboard-bar-height', bucket.views
        ? Math.max(7, bucket.views / maximum * 100).toFixed(2) + '%'
        : '0%');
      plot.appendChild(bar);
      var tick = element('span', 'dashboard-timeline-tick', bucket.tick);
      tick.setAttribute('aria-hidden', 'true');
      button.append(plot, tick);
      button.addEventListener('click', function () { selectBucket(index, false); });
      button.addEventListener('keydown', function (event) {
        var target = index;
        if (event.key === 'ArrowLeft') target = Math.max(0, index - 1);
        else if (event.key === 'ArrowRight') target = Math.min(buttons.length - 1, index + 1);
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = buttons.length - 1;
        else return;
        event.preventDefault();
        selectBucket(target, true);
      });
      buttons.push(button);
      fragment.appendChild(button);
    });
    state.chart.style.setProperty('--dashboard-timeline-columns', String(buckets.length));
    state.chart.replaceChildren(fragment);
    selectBucket(buckets.length - 1, false);

    var rangeStart = addUtcDays(state.startsOn, state.startOffset);
    var rangeEnd = addUtcDays(state.startsOn, state.startOffset + state.spanDays - 1);
    var windowLabel = trafficWindowLabel(state, result.bucketDays);
    document.getElementById('traffic-zoom-label').textContent = windowLabel;
    document.getElementById('traffic-range').textContent = dateFormat.format(rangeStart) + ' to '
      + dateFormat.format(rangeEnd) + '. ' + numberFormat.format(total) + ' recorded page view'
      + (total === 1 ? '' : 's') + ' in this range.';
    state.viewport.setAttribute('aria-label', 'Interactive page-view timeline showing ' + windowLabel
      + '. Scroll to zoom, drag to pan, or focus the chart and use the arrow, plus, minus, Home, and End keys.');
    var minimumSpan = Math.min(MIN_TRAFFIC_TIMELINE_DAYS, state.totalDays);
    document.getElementById('traffic-zoom-out').disabled = state.spanDays >= state.totalDays;
    document.getElementById('traffic-zoom-in').disabled = state.spanDays <= minimumSpan;
    document.getElementById('traffic-all').disabled = state.spanDays === state.totalDays;
    document.getElementById('traffic-latest').disabled = state.startOffset + state.spanDays >= state.totalDays;
  }

  function queueTrafficTimelineRender() {
    var state = trafficTimelineState;
    if (!state || state.renderFrame !== null) return;
    state.renderFrame = window.requestAnimationFrame(function () {
      if (!trafficTimelineState || trafficTimelineState !== state) return;
      state.renderFrame = null;
      renderTrafficTimeline();
    });
  }

  function zoomTrafficTimeline(scale, focusRatio) {
    var state = trafficTimelineState;
    if (!state || !Number.isFinite(scale) || scale <= 0) return false;
    var minimumSpan = Math.min(MIN_TRAFFIC_TIMELINE_DAYS, state.totalDays);
    var nextSpan = Math.round(state.spanDays * scale);
    if (scale < 1 && nextSpan === state.spanDays) nextSpan -= 1;
    if (scale > 1 && nextSpan === state.spanDays) nextSpan += 1;
    nextSpan = Math.max(minimumSpan, Math.min(state.totalDays, nextSpan));
    if (nextSpan === state.spanDays) return false;
    var ratio = Math.max(0, Math.min(1, focusRatio));
    var focusOffset = state.startOffset + ratio * (state.spanDays - 1);
    state.startOffset = clampTrafficStart(state, focusOffset - ratio * (nextSpan - 1), nextSpan);
    state.spanDays = nextSpan;
    return true;
  }

  function panTrafficTimeline(dayDelta) {
    var state = trafficTimelineState;
    if (!state || !Number.isFinite(dayDelta)) return false;
    var nextStart = clampTrafficStart(state, state.startOffset + dayDelta, state.spanDays);
    if (nextStart === state.startOffset) return false;
    state.startOffset = nextStart;
    return true;
  }

  function initializeTrafficTimeline(data) {
    if (!data.timelineStartsOn) {
      resetTrafficTimeline('No traffic history has been recorded yet.');
      document.getElementById('traffic-trend').replaceChildren(
        element('p', 'dashboard-empty', 'The timeline will appear after the first counted page view.')
      );
      return;
    }
    var startsOn = utcDate(data.timelineStartsOn);
    var today = utcDate(data.snapshotEndsOn);
    var totalDays = utcDayDistance(startsOn, today) + 1;
    var dailyViews = new Array(totalDays).fill(0);
    data.timeline.forEach(function (day) {
      var offset = utcDayDistance(startsOn, utcDate(day.date));
      if (offset >= 0 && offset < totalDays) dailyViews[offset] = day.views;
    });
    var prefixViews = [0];
    dailyViews.forEach(function (views) {
      prefixViews.push(prefixViews[prefixViews.length - 1] + views);
    });

    var host = document.getElementById('traffic-trend');
    var viewport = element('div', 'dashboard-timeline-scroll');
    viewport.tabIndex = 0;
    viewport.setAttribute('aria-describedby', 'traffic-help traffic-range traffic-detail');
    var chart = element('div', 'dashboard-timeline-chart');
    viewport.appendChild(chart);
    var key = element('div', 'dashboard-timeline-key');
    var recordedKey = element('span', 'dashboard-timeline-key-item');
    recordedKey.append(element('i', 'dashboard-timeline-key-recorded'), document.createTextNode('Recorded totals'));
    key.appendChild(recordedKey);
    host.replaceChildren(viewport, key);

    trafficTimelineState = {
      chart: chart,
      prefixViews: prefixViews,
      renderFrame: null,
      spanDays: totalDays,
      startOffset: 0,
      startsOn: startsOn,
      suppressClick: false,
      today: today,
      totalDays: totalDays,
      viewport: viewport
    };

    viewport.addEventListener('wheel', function (event) {
      var delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= Math.max(1, viewport.clientHeight);
      var bounds = viewport.getBoundingClientRect();
      var focusRatio = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0.5;
      var scale = Math.exp(Math.max(-600, Math.min(600, delta)) * 0.0015);
      if (!zoomTrafficTimeline(scale, focusRatio)) return;
      event.preventDefault();
      queueTrafficTimelineRender();
    }, { passive: false });

    viewport.addEventListener('pointerdown', function (event) {
      var state = trafficTimelineState;
      if (!state || event.button !== 0 || state.spanDays >= state.totalDays) return;
      state.drag = {
        moved: false,
        pointerId: event.pointerId,
        startOffset: state.startOffset,
        startX: event.clientX,
        width: Math.max(1, viewport.clientWidth)
      };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('dashboard-timeline-dragging');
    });

    viewport.addEventListener('pointermove', function (event) {
      var state = trafficTimelineState;
      if (!state || !state.drag || state.drag.pointerId !== event.pointerId) return;
      var pixels = event.clientX - state.drag.startX;
      if (Math.abs(pixels) > 3) state.drag.moved = true;
      var nextStart = clampTrafficStart(
        state,
        state.drag.startOffset - pixels / state.drag.width * state.spanDays,
        state.spanDays
      );
      if (nextStart === state.startOffset) return;
      state.startOffset = nextStart;
      queueTrafficTimelineRender();
    });

    function finishDrag(event) {
      var state = trafficTimelineState;
      if (!state || !state.drag || state.drag.pointerId !== event.pointerId) return;
      state.suppressClick = state.drag.moved;
      state.drag = null;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      viewport.classList.remove('dashboard-timeline-dragging');
    }
    viewport.addEventListener('pointerup', finishDrag);
    viewport.addEventListener('pointercancel', finishDrag);
    viewport.addEventListener('lostpointercapture', function () {
      var state = trafficTimelineState;
      if (!state || !state.drag) return;
      state.suppressClick = state.drag.moved;
      state.drag = null;
      viewport.classList.remove('dashboard-timeline-dragging');
    });
    viewport.addEventListener('click', function (event) {
      var state = trafficTimelineState;
      if (!state || !state.suppressClick) return;
      state.suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);

    viewport.addEventListener('keydown', function (event) {
      if (event.target !== viewport) return;
      var changed = false;
      var panStep = Math.max(1, Math.round(trafficTimelineState.spanDays * 0.15));
      if (event.key === 'ArrowLeft') changed = panTrafficTimeline(-panStep);
      else if (event.key === 'ArrowRight') changed = panTrafficTimeline(panStep);
      else if (event.key === '+' || event.key === '=') changed = zoomTrafficTimeline(0.5, 0.5);
      else if (event.key === '-' || event.key === '_') changed = zoomTrafficTimeline(2, 0.5);
      else if (event.key === 'Home') {
        trafficTimelineState.startOffset = 0;
        trafficTimelineState.spanDays = trafficTimelineState.totalDays;
        changed = true;
      } else if (event.key === 'End') {
        trafficTimelineState.startOffset = trafficTimelineState.totalDays - trafficTimelineState.spanDays;
        changed = true;
      } else return;
      event.preventDefault();
      if (changed) renderTrafficTimeline();
    });

    document.getElementById('traffic-zoom-out').onclick = function () {
      if (zoomTrafficTimeline(2, 0.5)) renderTrafficTimeline();
    };
    document.getElementById('traffic-zoom-in').onclick = function () {
      if (zoomTrafficTimeline(0.5, 0.5)) renderTrafficTimeline();
    };
    document.getElementById('traffic-all').onclick = function () {
      trafficTimelineState.startOffset = 0;
      trafficTimelineState.spanDays = trafficTimelineState.totalDays;
      renderTrafficTimeline();
    };
    document.getElementById('traffic-latest').onclick = function () {
      trafficTimelineState.startOffset = trafficTimelineState.totalDays - trafficTimelineState.spanDays;
      renderTrafficTimeline();
    };
    trafficTimelineState.resizeHandler = queueTrafficTimelineRender;
    window.addEventListener('resize', trafficTimelineState.resizeHandler);
    renderTrafficTimeline();
  }

  function renderTopPages(pages) {
    var host = document.getElementById('top-pages');
    if (!pages.length) {
      var empty = element('li', 'dashboard-empty', 'No page views have been recorded yet.');
      host.replaceChildren(empty);
      return;
    }
    var fragment = document.createDocumentFragment();
    pages.forEach(function (page) {
      var item = element('li');
      var link = element('a', '', page.title);
      link.href = page.path;
      var count = element('strong', '', numberFormat.format(page.views));
      item.append(link, count);
      fragment.appendChild(item);
    });
    host.replaceChildren(fragment);
  }

  function renderTrafficYearly(yearly) {
    if (!yearly.length) {
      document.getElementById('traffic-yearly').replaceChildren(
        element('p', 'dashboard-empty', 'The yearly summary will appear after the first counted page view.')
      );
      return;
    }
    renderBarList('traffic-yearly', yearly.slice().reverse().map(function (item) {
      return { label: item.year, count: item.views };
    }));
  }

  function renderTraffic(value, trackedPages) {
    var data = validateTraffic(value);
    if (!Number.isSafeInteger(trackedPages) || trackedPages < 1 || trackedPages > MAX_METRIC_PAGES) {
      throw new Error('Tracked page count is invalid');
    }
    var status = document.getElementById('traffic-status');
    status.textContent = data.totalViews ? 'Live' : 'Collecting';
    status.classList.add('dashboard-status-ready');
    var since = data.collectingSince ? 'Since ' + dateFormat.format(utcDate(data.collectingSince)) : 'Waiting for the first view';
    var measured = numberFormat.format(data.measuredPages) + ' page' + (data.measuredPages === 1 ? '' : 's')
      + ' with at least one view';
    document.getElementById('traffic-stats').replaceChildren(
      statCard(numberFormat.format(data.totalViews), 'Counted page views', since),
      statCard(numberFormat.format(trackedPages), 'Pages tracked', measured)
    );
    initializeTrafficTimeline(data);
    renderTrafficYearly(data.yearly);
    renderTopPages(data.topPages);
  }

  function renderTrafficUnavailable() {
    var status = document.getElementById('traffic-status');
    status.textContent = window.location.hostname === 'oliabak.com' ? 'Unavailable' : 'Production only';
    var notice = element('p', 'dashboard-empty', window.location.hostname === 'oliabak.com'
      ? 'Traffic statistics are temporarily unavailable.'
      : 'Live traffic statistics appear on the published site.');
    document.getElementById('traffic-stats').replaceChildren(notice);
    resetTrafficTimeline('Traffic history is unavailable.');
    document.getElementById('traffic-yearly').replaceChildren(
      element('p', 'dashboard-empty', 'Yearly traffic totals are unavailable.')
    );
    document.getElementById('top-pages').replaceChildren();
  }

  function loadTraffic(trackedPages) {
    if (!window.siteMetrics || typeof window.siteMetrics.dashboard !== 'function') {
      renderTrafficUnavailable();
      return;
    }
    window.siteMetrics.dashboard().then(function (value) {
      renderTraffic(value, trackedPages);
    }).catch(renderTrafficUnavailable);
  }

  function initialize() {
    var root = document.getElementById('publishing-dashboard');
    if (!root) return;
    initializeAccountStatus();
    loadPublicationData().then(function (data) {
      renderPublicationStats(data);
      loadWebsiteUpdate().then(renderWebsiteUpdate).catch(renderWebsiteUpdateUnavailable);
      renderYearControl(data);
      renderBreakdowns(data);
      renderRecent(data);
      loadTraffic(data.metricPageCount);
      document.getElementById('dashboard-loading').remove();
      root.classList.add('dashboard-ready');
    }).catch(function () {
      var loading = document.getElementById('dashboard-loading');
      loading.textContent = 'Publication statistics could not be loaded. Please try again after the next site build.';
      loading.classList.add('dashboard-loading-error');
      renderEdgeConnectionUnavailable();
      renderTrafficUnavailable();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
