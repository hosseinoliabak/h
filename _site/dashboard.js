/* Publication and traffic dashboard for H's Notes.
 *
 * Publication data is generated from first-publication dates in source front
 * matter. Traffic data contains aggregate counters supplied by the protected
 * site metrics function. Every string is inserted through textContent.
 */
(function () {
  'use strict';

  var DATA_URL = '/about/dashboard-data.json';
  var MAX_DATA_BYTES = 1024 * 1024;
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
  var dateFormat = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
  var monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
  var updateDayFormat = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  });
  var updateTimeFormat = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function utcDate(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var value = new Date(iso + 'T00:00:00Z');
    return Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== iso ? null : value;
  }

  function isoDate(value) {
    return value.toISOString().slice(0, 10);
  }

  function validInternalPath(value) {
    return typeof value === 'string'
      && value.length <= 320
      && (value === '/' || /^\/(?:[A-Za-z0-9_-]+\/)*(?:[A-Za-z0-9_-]+\.html)?$/.test(value))
      && !value.includes('//')
      && !value.includes('..');
  }

  function validatePublicationData(value) {
    if (!value || value.schemaVersion !== 1 || !utcDate(value.generatedOn)
        || !Number.isSafeInteger(value.metricPageCount) || value.metricPageCount < 1 || value.metricPageCount > 5000
        || !Array.isArray(value.articles) || value.articles.length > 2000) {
      throw new Error('Publication data has an unsupported shape');
    }
    var seen = new Set();
    var articles = value.articles.map(function (item) {
      if (!item || !utcDate(item.date) || typeof item.title !== 'string'
          || item.title.length < 1 || item.title.length > 240
          || !validInternalPath(item.href) || !SUBJECTS.has(item.subject)) {
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
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      });
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder('utf-8', { fatal: true });
    var total = 0;
    var text = '';
    function next() {
      return reader.read().then(function (part) {
        if (part.done) return text + decoder.decode();
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

  function loadPublicationData() {
    var url = new URL(DATA_URL, window.location.href);
    if (url.origin !== window.location.origin) return Promise.reject(new Error('Publication data origin is not allowed'));
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, 10000);
    return window.fetch(url.href, {
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
      return readBoundedBody(response, MAX_DATA_BYTES);
    }).then(function (source) {
      return validatePublicationData(JSON.parse(source));
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
    }).then(function (source) {
      return validateWebsiteUpdate(JSON.parse(source));
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
    var time = element('time', '', updateDayFormat.format(date) + ', ' + updateTimeFormat.format(date));
    time.dateTime = date.toISOString();
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
        || !Number.isSafeInteger(value.measuredPages) || value.measuredPages < 0 || value.measuredPages > 5000
        || !Array.isArray(value.daily) || value.daily.length > 31
        || !Array.isArray(value.topPages) || value.topPages.length > 20) {
      throw new Error('Traffic data has an unsupported shape');
    }
    var daily = value.daily.map(function (item) {
      if (!item || !utcDate(item.date) || !Number.isSafeInteger(item.views) || item.views < 0) throw new Error('Traffic day is invalid');
      return { date: item.date, views: item.views };
    });
    var topPages = value.topPages.map(function (item) {
      if (!item || !validInternalPath(item.path) || typeof item.title !== 'string' || item.title.length < 1 || item.title.length > 180
          || !Number.isSafeInteger(item.views) || item.views < 1) throw new Error('Traffic page is invalid');
      return { path: item.path, title: item.title, views: item.views };
    });
    return {
      totalViews: value.totalViews,
      last30Days: value.last30Days,
      measuredPages: value.measuredPages,
      collectingSince: value.collectingSince && utcDate(value.collectingSince) ? value.collectingSince : null,
      daily: daily,
      topPages: topPages
    };
  }

  function renderTrafficTrend(days) {
    var host = document.getElementById('traffic-trend');
    if (!days.length) {
      host.replaceChildren(element('p', 'dashboard-empty', 'No traffic has been recorded yet.'));
      return;
    }
    var maximum = Math.max.apply(null, days.map(function (day) { return day.views; }).concat([1]));
    var chart = element('div', 'dashboard-spark-chart');
    days.forEach(function (day, index) {
      var bar = element('span', 'dashboard-spark-bar');
      bar.style.setProperty('--dashboard-bar-height', Math.max(day.views ? 5 : 1, day.views / maximum * 100).toFixed(2) + '%');
      bar.title = dateFormat.format(utcDate(day.date)) + '. ' + numberFormat.format(day.views) + ' page view' + (day.views === 1 ? '' : 's') + '.';
      bar.setAttribute('aria-label', bar.title);
      if (index === days.length - 1) bar.classList.add('dashboard-spark-current');
      chart.appendChild(bar);
    });
    var axis = element('div', 'dashboard-spark-axis');
    axis.append(
      element('span', '', dateFormat.format(utcDate(days[0].date))),
      element('span', '', dateFormat.format(utcDate(days[days.length - 1].date)))
    );
    host.replaceChildren(chart, axis);
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

  function renderTraffic(value, trackedPages) {
    var data = validateTraffic(value);
    if (!Number.isSafeInteger(trackedPages) || trackedPages < 1 || trackedPages > 5000) {
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
      statCard(numberFormat.format(data.last30Days), 'Past 30 days', 'Aggregate page opens'),
      statCard(numberFormat.format(trackedPages), 'Pages tracked', measured)
    );
    renderTrafficTrend(data.daily);
    renderTopPages(data.topPages);
  }

  function renderTrafficUnavailable() {
    var status = document.getElementById('traffic-status');
    status.textContent = window.location.hostname === 'h.oliabak.com' ? 'Unavailable' : 'Production only';
    var notice = element('p', 'dashboard-empty', window.location.hostname === 'h.oliabak.com'
      ? 'Traffic statistics are temporarily unavailable.'
      : 'Live traffic statistics appear on the published site.');
    document.getElementById('traffic-stats').replaceChildren(notice);
    document.getElementById('traffic-trend').replaceChildren();
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
      renderTrafficUnavailable();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
