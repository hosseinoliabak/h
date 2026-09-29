/* CISSP Exam Simulator engine.
 *
 * Everything that picks a question, scores an answer, or estimates ability
 * lives here, with no DOM and no network, so the same file runs in the page
 * and under node's test runner. The page (cissp-exam.js) only draws what this
 * returns. Session state is plain data (question ids, answers, numbers), so it
 * can be saved to localStorage and resumed after a reload.
 *
 * Three modes.
 *
 *   exam      A computerized adaptive test in the manner of the real CISSP
 *             CAT: 100 to 150 items, three hours, no going back. Ability is a
 *             Rasch estimate. An item's difficulty comes from its level, 1
 *             (recall) to 5 (multi-step), mapped to -2 .. +2 on the ability
 *             scale. After a wrong answer the next item comes from the same
 *             domain at the same or a lower level, which re-tests that area.
 *             After a right answer the domain furthest below its 2024
 *             outline weight goes next, at the level nearest the current
 *             estimate. The exam stops once at least 100 items are answered
 *             and the 95 percent interval lies wholly above or below the pass
 *             line, or at 150 items, or when time runs out.
 *   drill     Mastery practice. A missed item comes back after a few others
 *             until it is answered correctly, and the level of a domain rises
 *             after two correct answers in a row and falls after a miss.
 *   practice  N items drawn from the chosen domains in proportion to the
 *             outline weights.
 *
 * The pass line is not the ISC2 scale, which is not published. It is the
 * ability at which a candidate would answer about 70 percent of a
 * domain-weighted mix of this bank correctly, and the scaled score maps that
 * point to 700 of 1000. The page says so.
 *
 * Loaded in the browser as window.CisspExam, and in node through module.exports.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.CisspExam = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;

  var DOMAINS = {
    1: 'Security and Risk Management',
    2: 'Asset Security',
    3: 'Security Architecture and Engineering',
    4: 'Communication and Network Security',
    5: 'Identity and Access Management',
    6: 'Security Assessment and Testing',
    7: 'Security Operations',
    8: 'Software Development Security'
  };

  /* CISSP exam outline effective April 15, 2024. */
  var WEIGHTS = { 1: 0.16, 2: 0.10, 3: 0.13, 4: 0.13, 5: 0.13, 6: 0.12, 7: 0.13, 8: 0.10 };

  var LEVELS = { 1: 'Recall', 2: 'Apply', 3: 'Distinguish', 4: 'Judge', 5: 'Master' };
  var LEVEL_DIFFICULTY = { 1: -2, 2: -1, 3: 0, 4: 1, 5: 2 };

  /* Every bound the page relies on, in one place. The pool limits guard the
     schema check; the exam limits copy the published CISSP CAT format. */
  var LIMITS = {
    maxQuestions: 5000,
    maxIdLength: 40,
    maxStemLength: 6000,
    maxOptionLength: 1500,
    minOptions: 2,
    maxOptions: 8,
    maxAnswerLength: 200,
    maxJustificationLength: 3000,
    examMinItems: 100,
    examMaxItems: 150,
    examMinutes: 180,
    passAccuracy: 0.70,
    confidenceZ: 1.96,
    drillRetryGap: 3,
    drillStreakToLevelUp: 2,
    practiceMin: 1,
    practiceMax: 250
  };

  var GRID = (function () {
    var g = [];
    for (var t = -4; t <= 4.0001; t += 0.05) g.push(Math.round(t * 100) / 100);
    return g;
  })();

  /* ------------------------------ pool ------------------------------ */

  function isText(value, max) {
    return typeof value === 'string' && value.length > 0 && value.length <= max;
  }

  /* The pool comes from a store only the owner can read, but it is still
     checked field by field before use, so a malformed upload fails loudly
     here rather than halfway through an exam. Returns a normalized pool or
     throws with the first problem found. */
  function validatePool(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('The question bank is empty or unreadable.');
    var list = Array.isArray(raw.q) ? raw.q : (raw.q && typeof raw.q === 'object' ? Object.keys(raw.q).map(function (k) { return raw.q[k]; }) : null);
    if (!list || !list.length) throw new Error('The question bank holds no questions.');
    if (list.length > LIMITS.maxQuestions) throw new Error('The question bank is larger than ' + LIMITS.maxQuestions + ' questions.');
    var seen = Object.create(null);
    var out = [];
    list.forEach(function (q, n) {
      var where = 'Question ' + (n + 1);
      if (!q || typeof q !== 'object') throw new Error(where + ' is not an object.');
      if (!isText(q.i, LIMITS.maxIdLength) || !/^[a-z0-9-]+$/.test(q.i)) throw new Error(where + ' has an invalid id.');
      if (seen[q.i]) throw new Error(where + ' repeats the id ' + q.i + '.');
      seen[q.i] = true;
      if (!DOMAINS[q.d]) throw new Error(q.i + ' has an invalid domain.');
      if (!LEVELS[q.l]) throw new Error(q.i + ' has an invalid level.');
      var format = q.f || 'mcq';
      if (format !== 'mcq' && format !== 'matching' && format !== 'ordering') throw new Error(q.i + ' has an unknown format.');
      if (!isText(q.s, LIMITS.maxStemLength)) throw new Error(q.i + ' has no stem.');
      if (!isText(q.j, LIMITS.maxJustificationLength)) throw new Error(q.i + ' has no justification.');
      var options = [];
      if (format === 'mcq') {
        if (!Array.isArray(q.o) || q.o.length < LIMITS.minOptions || q.o.length > LIMITS.maxOptions) throw new Error(q.i + ' has the wrong number of options.');
        q.o.forEach(function (o) { if (!isText(o, LIMITS.maxOptionLength)) throw new Error(q.i + ' has an empty or overlong option.'); });
        options = q.o.slice();
        if (typeof q.a !== 'number' || q.a !== Math.floor(q.a) || q.a < 0 || q.a >= options.length) throw new Error(q.i + ' has an answer outside its options.');
      } else if (!isText(q.a, LIMITS.maxAnswerLength)) {
        throw new Error(q.i + ' has no answer.');
      }
      out.push({ id: q.i, domain: q.d, level: q.l, format: format, stem: q.s, options: options, answer: q.a, justification: q.j });
    });
    return makePool(out);
  }

  function makePool(questions) {
    var byId = Object.create(null);
    var byDomain = {};
    Object.keys(DOMAINS).forEach(function (d) { byDomain[d] = []; });
    questions.forEach(function (q) { byId[q.id] = q; byDomain[q.domain].push(q.id); });
    var pool = { questions: questions, byId: byId, byDomain: byDomain };
    pool.passTheta = passTheta(pool);
    return pool;
  }

  function counts(pool) {
    var c = {};
    Object.keys(DOMAINS).forEach(function (d) { c[d] = 0; });
    pool.questions.forEach(function (q) { c[q.domain] += 1; });
    return c;
  }

  /* ------------------------------ ability ------------------------------ */

  function probability(theta, b) {
    return 1 / (1 + Math.exp(-(theta - b)));
  }

  /* Expected accuracy on a domain-weighted mix of the bank's multiple-choice
     items, as a function of ability. Within a domain the levels count in the
     proportions the bank holds them. */
  function expectedAccuracy(pool, theta) {
    var total = 0;
    var weight = 0;
    Object.keys(DOMAINS).forEach(function (d) {
      var ids = pool.byDomain[d].filter(function (id) { return pool.byId[id].format === 'mcq'; });
      if (!ids.length) return;
      var sum = 0;
      ids.forEach(function (id) { sum += probability(theta, LEVEL_DIFFICULTY[pool.byId[id].level]); });
      total += WEIGHTS[d] * (sum / ids.length);
      weight += WEIGHTS[d];
    });
    return weight ? total / weight : 0;
  }

  /* The ability at which expected accuracy is passAccuracy, by bisection. */
  function passTheta(pool) {
    var lo = -4;
    var hi = 4;
    for (var i = 0; i < 60; i += 1) {
      var mid = (lo + hi) / 2;
      if (expectedAccuracy(pool, mid) < LIMITS.passAccuracy) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* Expected a posteriori estimate under a standard normal prior. The prior
     keeps the estimate finite after an all-right or all-wrong start. */
  function estimate(responses) {
    var logs = GRID.map(function (t) { return -0.5 * t * t; });
    responses.forEach(function (r) {
      for (var i = 0; i < GRID.length; i += 1) {
        var p = probability(GRID[i], r.b);
        logs[i] += Math.log(r.correct ? p : 1 - p);
      }
    });
    var max = Math.max.apply(null, logs);
    var mass = 0;
    var mean = 0;
    var second = 0;
    for (var i = 0; i < GRID.length; i += 1) {
      var w = Math.exp(logs[i] - max);
      mass += w;
      mean += w * GRID[i];
      second += w * GRID[i] * GRID[i];
    }
    mean /= mass;
    var variance = Math.max(second / mass - mean * mean, 1e-6);
    return { theta: mean, se: Math.sqrt(variance) };
  }

  function scaled(theta, pass) {
    return Math.max(0, Math.min(1000, Math.round(700 + 150 * (theta - pass))));
  }

  /* ------------------------------ helpers ------------------------------ */

  function pick(list, rng) {
    return list[Math.floor(rng() * list.length) % list.length];
  }

  function shuffle(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function domainList(domains) {
    var list = (domains && domains.length ? domains : Object.keys(DOMAINS)).map(Number).filter(function (d) { return DOMAINS[d]; });
    return list.filter(function (d, i) { return list.indexOf(d) === i; }).sort();
  }

  /* The domain furthest below its target share of the next item. */
  function neediestDomain(domains, tally, total, available) {
    var weightSum = 0;
    domains.forEach(function (d) { weightSum += WEIGHTS[d]; });
    var best = null;
    var bestGap = -Infinity;
    domains.forEach(function (d) {
      if (!available(d)) return;
      var gap = (WEIGHTS[d] / weightSum) * (total + 1) - (tally[d] || 0);
      if (gap > bestGap) { bestGap = gap; best = d; }
    });
    return best;
  }

  function isCorrect(q, choice) {
    return q.format === 'mcq' ? choice === q.answer : choice === true;
  }

  /* ------------------------------ exam (CAT) ------------------------------ */

  function createExam(pool, now) {
    return {
      v: VERSION, mode: 'exam', startedAt: now, finishedAt: null, finishReason: null,
      asked: [], responses: [], current: null, lastWrong: null, tally: {}
    };
  }

  function examAvailable(pool, state, domain, maxLevel) {
    var used = Object.create(null);
    state.asked.forEach(function (id) { used[id] = true; });
    return pool.byDomain[domain].filter(function (id) {
      var q = pool.byId[id];
      return !used[id] && q.format === 'mcq' && (maxLevel === undefined || q.level <= maxLevel);
    });
  }

  function nearestLevel(pool, ids, theta, rng) {
    var bestDistance = Infinity;
    var best = [];
    ids.forEach(function (id) {
      var distance = Math.abs(LEVEL_DIFFICULTY[pool.byId[id].level] - theta);
      if (distance < bestDistance - 1e-9) { bestDistance = distance; best = [id]; }
      else if (Math.abs(distance - bestDistance) <= 1e-9) best.push(id);
    });
    return best.length ? pick(best, rng) : null;
  }

  function examNext(pool, state, rng) {
    if (state.finishedAt) return null;
    if (state.current) return state.current;
    var est = estimate(state.responses);
    var id = null;
    if (state.lastWrong) {
      /* Re-test the area just missed: same domain, same or lower level. */
      var retest = examAvailable(pool, state, state.lastWrong.domain, state.lastWrong.level);
      id = nearestLevel(pool, retest, Math.min(est.theta, LEVEL_DIFFICULTY[state.lastWrong.level]), rng);
    }
    if (!id) {
      var domains = domainList();
      var d = neediestDomain(domains, state.tally, state.asked.length, function (x) {
        return examAvailable(pool, state, x).length > 0;
      });
      if (d === null) return null;
      id = nearestLevel(pool, examAvailable(pool, state, d), est.theta, rng);
    }
    state.current = id;
    return id;
  }

  function examAnswer(pool, state, choice, now) {
    if (!state.current || state.finishedAt) throw new Error('No question is waiting for an answer.');
    var q = pool.byId[state.current];
    var correct = isCorrect(q, choice);
    state.asked.push(q.id);
    state.responses.push({ id: q.id, choice: choice, correct: correct, b: LEVEL_DIFFICULTY[q.level] });
    state.tally[q.domain] = (state.tally[q.domain] || 0) + 1;
    state.lastWrong = correct ? null : { domain: q.domain, level: q.level };
    state.current = null;
    var reason = examStopReason(pool, state, now);
    if (reason) { state.finishedAt = now; state.finishReason = reason; }
    return { correct: correct, finished: Boolean(reason) };
  }

  function examStopReason(pool, state, now) {
    var n = state.responses.length;
    if (now - state.startedAt >= LIMITS.examMinutes * 60000) return 'time';
    if (n >= LIMITS.examMaxItems) return 'maximum';
    if (n >= LIMITS.examMinItems) {
      var est = estimate(state.responses);
      var margin = LIMITS.confidenceZ * est.se;
      if (est.theta - margin > pool.passTheta || est.theta + margin < pool.passTheta) return 'confident';
    }
    var remaining = domainList().some(function (d) { return examAvailable(pool, state, d).length > 0; });
    return remaining ? null : 'bank';
  }

  /* Call on a timer: ends the exam when the three hours are up. */
  function examTick(pool, state, now) {
    if (state.finishedAt) return false;
    if (now - state.startedAt >= LIMITS.examMinutes * 60000) {
      state.finishedAt = state.startedAt + LIMITS.examMinutes * 60000;
      state.finishReason = 'time';
      state.current = null;
      return true;
    }
    return false;
  }

  function examResult(pool, state) {
    var est = estimate(state.responses);
    var n = state.responses.length;
    /* As on the real exam, running out of time before the minimum number of
       items is a fail whatever the estimate says. */
    var shortOfMinimum = state.finishReason === 'time' && n < LIMITS.examMinItems;
    var pass = !shortOfMinimum && est.theta >= pool.passTheta;
    var byDomain = domainBreakdown(pool, state.responses);
    Object.keys(byDomain).forEach(function (d) {
      var row = byDomain[d];
      if (!row.asked) { row.standing = 'not tested'; return; }
      var e = estimate(state.responses.filter(function (r) { return pool.byId[r.id].domain === Number(d); }));
      row.standing = e.theta - e.se > pool.passTheta ? 'above' : (e.theta + e.se < pool.passTheta ? 'below' : 'near');
    });
    return {
      pass: pass, shortOfMinimum: shortOfMinimum, theta: est.theta, se: est.se,
      score: scaled(est.theta, pool.passTheta), items: n,
      correct: state.responses.filter(function (r) { return r.correct; }).length,
      minutes: Math.round(((state.finishedAt || state.startedAt) - state.startedAt) / 60000),
      reason: state.finishReason, byDomain: byDomain,
      missed: state.responses.filter(function (r) { return !r.correct; }).map(function (r) { return r.id; })
    };
  }

  function domainBreakdown(pool, responses) {
    var out = {};
    Object.keys(DOMAINS).forEach(function (d) { out[d] = { asked: 0, correct: 0 }; });
    responses.forEach(function (r) {
      var row = out[pool.byId[r.id].domain];
      row.asked += 1;
      if (r.correct) row.correct += 1;
    });
    return out;
  }

  /* ------------------------------ drill ------------------------------ */

  function createDrill(pool, domains, now) {
    var list = domainList(domains);
    var level = {};
    list.forEach(function (d) { level[d] = 1; });
    return {
      v: VERSION, mode: 'drill', startedAt: now, finishedAt: null, domains: list,
      level: level, streak: {}, retry: [], asked: [], responses: [], current: null,
      forceDomain: null, mastered: [], step: 0, tally: {}
    };
  }

  function drillNext(pool, state, rng) {
    if (state.finishedAt) return null;
    if (state.current) return state.current;
    state.step += 1;
    var due = state.retry.filter(function (r) { return r.due <= state.step; });
    if (due.length) {
      state.current = due[0].id;
      state.currentIsRetry = true;
      return state.current;
    }
    state.currentIsRetry = false;
    var used = Object.create(null);
    state.asked.forEach(function (id) { used[id] = true; });
    state.retry.forEach(function (r) { used[r.id] = true; });
    function fresh(d, lvl) {
      return pool.byDomain[d].filter(function (id) {
        var q = pool.byId[id];
        return !used[id] && q.format === 'mcq' && (lvl === undefined || q.level === lvl);
      });
    }
    var d = state.forceDomain && fresh(state.forceDomain).length ? state.forceDomain
      : neediestDomain(state.domains, state.tally, state.asked.length, function (x) { return fresh(x).length > 0; });
    if (d === null) {
      if (state.retry.length) {
        state.current = state.retry[0].id;
        state.currentIsRetry = true;
        return state.current;
      }
      return null;
    }
    /* Nearest level to the domain's current level that still has items,
       preferring the lower one on a tie. */
    var target = state.level[d];
    var id = null;
    for (var step = 0; step <= 4 && !id; step += 1) {
      [target - step, target + step].forEach(function (lvl) {
        if (id || lvl < 1 || lvl > 5) return;
        var ids = fresh(d, lvl);
        if (ids.length) id = pick(ids, rng);
      });
    }
    state.current = id;
    return id;
  }

  function drillAnswer(pool, state, choice) {
    if (!state.current || state.finishedAt) throw new Error('No question is waiting for an answer.');
    var q = pool.byId[state.current];
    var correct = isCorrect(q, choice);
    var wasRetry = state.retry.some(function (r) { return r.id === q.id; });
    state.retry = state.retry.filter(function (r) { return r.id !== q.id; });
    if (state.asked.indexOf(q.id) === -1) state.asked.push(q.id);
    state.responses.push({ id: q.id, choice: choice, correct: correct, retry: wasRetry });
    state.tally[q.domain] = (state.tally[q.domain] || 0) + 1;
    if (correct) {
      if (wasRetry) state.mastered.push(q.id);
      state.streak[q.domain] = (state.streak[q.domain] || 0) + 1;
      if (state.streak[q.domain] >= LIMITS.drillStreakToLevelUp && state.level[q.domain] < 5) {
        state.level[q.domain] += 1;
        state.streak[q.domain] = 0;
      }
      state.forceDomain = null;
    } else {
      state.streak[q.domain] = 0;
      state.level[q.domain] = Math.max(1, Math.min(state.level[q.domain], q.level));
      state.retry.push({ id: q.id, due: state.step + LIMITS.drillRetryGap + 1 });
      state.forceDomain = q.domain;
    }
    state.current = null;
    return { correct: correct };
  }

  function drillResult(pool, state) {
    var first = {};
    state.responses.forEach(function (r) { if (!(r.id in first)) first[r.id] = r.correct; });
    var ids = Object.keys(first);
    return {
      answered: state.responses.length,
      unique: ids.length,
      firstTimeCorrect: ids.filter(function (id) { return first[id]; }).length,
      mastered: state.mastered.length,
      outstanding: state.retry.map(function (r) { return r.id; }),
      level: Object.assign({}, state.level),
      byDomain: domainBreakdown(pool, state.responses.filter(function (r) { return !r.retry; }))
    };
  }

  /* ------------------------------ practice ------------------------------ */

  function createPractice(pool, options, rng, now) {
    var domains = domainList(options && options.domains);
    var includeOther = Boolean(options && options.includeOtherFormats);
    var n = Math.max(LIMITS.practiceMin, Math.min(LIMITS.practiceMax, Math.floor(Number(options && options.count) || 25)));
    var bags = {};
    var total = 0;
    domains.forEach(function (d) {
      bags[d] = shuffle(pool.byDomain[d].filter(function (id) {
        return includeOther || pool.byId[id].format === 'mcq';
      }), rng);
      total += bags[d].length;
    });
    n = Math.min(n, total);
    var order = [];
    var tally = {};
    while (order.length < n) {
      var d = neediestDomain(domains, tally, order.length, function (x) { return bags[x].length > 0; });
      if (d === null) break;
      order.push(bags[d].pop());
      tally[d] = (tally[d] || 0) + 1;
    }
    return {
      v: VERSION, mode: 'practice', startedAt: now, finishedAt: null, domains: domains,
      feedback: !(options && options.feedback === 'end'), order: shuffle(order, rng),
      index: 0, responses: [], current: null
    };
  }

  function practiceNext(pool, state) {
    if (state.finishedAt) return null;
    if (state.current) return state.current;
    if (state.index >= state.order.length) return null;
    state.current = state.order[state.index];
    return state.current;
  }

  function practiceAnswer(pool, state, choice, now) {
    if (!state.current || state.finishedAt) throw new Error('No question is waiting for an answer.');
    var q = pool.byId[state.current];
    var correct = isCorrect(q, choice);
    state.responses.push({ id: q.id, choice: choice, correct: correct });
    state.index += 1;
    state.current = null;
    if (state.index >= state.order.length) state.finishedAt = now;
    return { correct: correct, finished: Boolean(state.finishedAt) };
  }

  function practiceResult(pool, state) {
    return {
      answered: state.responses.length,
      planned: state.order.length,
      correct: state.responses.filter(function (r) { return r.correct; }).length,
      byDomain: domainBreakdown(pool, state.responses),
      missed: state.responses.filter(function (r) { return !r.correct; }).map(function (r) { return r.id; })
    };
  }

  /* ------------------------------ saved sessions ------------------------------ */

  /* A saved session is re-checked against the loaded bank before it is
     resumed: every id must still exist, and the shape must be the one this
     version writes. Anything else is discarded rather than trusted. */
  function validSession(pool, s) {
    if (!s || typeof s !== 'object' || s.v !== VERSION) return false;
    if (['exam', 'drill', 'practice'].indexOf(s.mode) === -1) return false;
    if (typeof s.startedAt !== 'number' || !Array.isArray(s.responses)) return false;
    var ids = [];
    s.responses.forEach(function (r) { ids.push(r && r.id); });
    if (s.current) ids.push(s.current);
    if (s.mode === 'practice') {
      if (!Array.isArray(s.order)) return false;
      ids = ids.concat(s.order);
    }
    if (s.mode === 'drill' && (!Array.isArray(s.retry) || !s.level)) return false;
    return ids.every(function (id) { return typeof id === 'string' && pool.byId[id]; });
  }

  return {
    VERSION: VERSION,
    DOMAINS: DOMAINS,
    WEIGHTS: WEIGHTS,
    LEVELS: LEVELS,
    LEVEL_DIFFICULTY: LEVEL_DIFFICULTY,
    LIMITS: LIMITS,
    validatePool: validatePool,
    counts: counts,
    probability: probability,
    expectedAccuracy: expectedAccuracy,
    estimate: estimate,
    scaled: scaled,
    createExam: createExam,
    examNext: examNext,
    examAnswer: examAnswer,
    examTick: examTick,
    examResult: examResult,
    createDrill: createDrill,
    drillNext: drillNext,
    drillAnswer: drillAnswer,
    drillResult: drillResult,
    createPractice: createPractice,
    practiceNext: practiceNext,
    practiceAnswer: practiceAnswer,
    practiceResult: practiceResult,
    validSession: validSession
  };
});
