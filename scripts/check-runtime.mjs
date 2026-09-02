import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const root = new URL('..', import.meta.url);
const appSource = await readFile(new URL('public/assets/app.js', root), 'utf8');
const publishedUpdates = JSON.parse(await readFile(new URL('dist/data/updates.json', root), 'utf8'));
const elementIds = [
  'score-note', 'tracks', 'history', 'updates', 'history-summary', 'score', 'verdict',
  'confidence', 'meter', 'alignment-meter', 'week-title', 'model', 'model-note',
  'updated', 'scenario-marker', 'scenario-date', 'reality-marker', 'freshness',
  'freshness-label'
];

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.innerHTML = '';
    this.style = {};
    this.textContent = '';
    this.scrolledIntoView = false;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  scrollIntoView() {
    this.scrolledIntoView = true;
  }
}

async function render(response, hash = '', now = `${publishedUpdates[0].date}T12:00:00Z`, fetchImpl = async () => response) {
  const updateIds = publishedUpdates.map(update => `update-${update.date}`);
  const elements = new Map([...elementIds, ...updateIds].map(id => [id, new FakeElement()]));
  for (const id of ['score-note', 'tracks', 'history', 'updates']) {
    elements.get(id).setAttribute('aria-busy', 'true');
  }
  elements.get('alignment-meter').setAttribute('aria-valuenow', '0');

  const errors = [];
  const timers = new Map();
  const requests = [];
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
  }
  const context = {
    console: {
      error: (...messages) => errors.push(messages.map(String).join(' ')),
      log: () => {}
    },
    document: {
      getElementById(id) {
        const element = elements.get(id);
        if (!element) throw new Error(`Unexpected element lookup: ${id}`);
        return element;
      }
    },
    fetch: (...args) => {
      requests.push(args);
      return fetchImpl(...args);
    },
    AbortController,
    setTimeout(callback, delay) {
      const id = timers.size + 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    location: { hash },
    Date: FixedDate,
    URL
  };

  new Script(appSource, { filename: 'public/assets/app.js' }).runInNewContext(context);
  await new Promise(resolve => setImmediate(resolve));
  return { elements, errors, timers, requests };
}

function element(result, id) {
  return result.elements.get(id);
}

function assertSettled(result) {
  assert.equal(result.timers.size, 0, 'Settled loads should clear their timeout');
  for (const id of ['score-note', 'tracks', 'history', 'updates']) {
    assert.equal(element(result, id).getAttribute('aria-busy'), 'false', `${id} should finish loading`);
  }
}

function occurrences(text, fragment) {
  return text.split(fragment).length - 1;
}

function daysAfter(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

const success = await render({
  ok: true,
  status: 200,
  json: async () => structuredClone(publishedUpdates)
});
const latest = publishedUpdates[0];
const sourceCount = publishedUpdates.reduce((total, update) => total + update.sources.length, 0);

assertSettled(success);
assert.deepEqual(success.errors, []);
assert.equal(element(success, 'score').textContent, latest.score);
assert.equal(element(success, 'verdict').dataset.verdict, latest.verdict);
assert.equal(element(success, 'meter').style.width, `${latest.score}%`);
assert.equal(element(success, 'alignment-meter').getAttribute('aria-valuenow'), String(latest.score));
assert.equal(
  element(success, 'alignment-meter').getAttribute('aria-valuetext'),
  `${latest.score} out of 100 — ${latest.verdict}`
);
assert.equal(element(success, 'score-note').hidden, true);
assert.equal(element(success, 'freshness').dataset.freshness, 'current');
assert.equal(element(success, 'freshness-label').textContent, 'Updated weekly');
assert.match(element(success, 'freshness').getAttribute('title'), /Latest assessment: .+ \(0 days ago\)/);
assert.match(element(success, 'updated').textContent, /^Assessment · .+ · (?:First assessment|No score change|Up|Down)/);
assert.equal(
  element(success, 'history-summary').textContent,
  `${publishedUpdates.length} published assessments · ${publishedUpdates.at(-1).score} → ${latest.score}`
);
assert.equal(occurrences(element(success, 'tracks').innerHTML, 'role="progressbar"'), 4);
assert.equal(occurrences(element(success, 'updates').innerHTML, 'class="update '), publishedUpdates.length);
assert.equal(occurrences(element(success, 'updates').innerHTML, 'class="source-kind"'), sourceCount);

// Publisher coverage is editorial metadata, not a prerequisite for publishing.
// Exercise the taxonomy separately so a new source can use the honest fallback.
for (const [url, expectedKind] of [
  ['https://ai-2027.com/', 'Scenario reference'],
  ['https://metr.org/time-horizons/', 'Independent research'],
  ['https://www.reuters.com/technology/', 'News reporting'],
  ['https://arxiv.org/abs/example', 'Research paper'],
  ['https://www.anthropic.com/news/example', 'First-party'],
  ['https://example.org/new-publisher', 'Other source'],
  ['https://reuters.com.example.org/report', 'Other source'],
  ['https://example.org/reuters.com', 'Other source']
]) {
  const update = structuredClone(latest);
  update.sources = [{ title: 'Source provenance fixture', url }];
  const result = await render({ ok: true, status: 200, json: async () => [update] });
  const html = element(result, 'updates').innerHTML;
  assertSettled(result);
  assert.deepEqual(result.errors, [], url);
  assert.equal(element(result, 'score').textContent, latest.score, url);
  assert.equal(occurrences(html, 'class="source-kind"'), 1, url);
  assert.ok(html.includes(`<span class="source-kind">${expectedKind}</span>`), url);
  assert.ok(html.includes(`href="${url}"`), url);
  assert.ok(html.includes('Source provenance fixture'), url);
}

const latestOnlyResponse = {
  ok: true,
  status: 200,
  json: async () => [structuredClone(latest)]
};
const graceBoundary = await render(latestOnlyResponse, '', daysAfter(latest.date, 10));
assert.equal(element(graceBoundary, 'freshness').dataset.freshness, 'current');
assert.equal(element(graceBoundary, 'freshness-label').textContent, 'Updated weekly');
assert.match(element(graceBoundary, 'freshness').getAttribute('title'), /\(10 days ago\)/);

const overdueBoundary = await render(latestOnlyResponse, '', daysAfter(latest.date, 11));
assert.equal(element(overdueBoundary, 'freshness').dataset.freshness, 'overdue');
assert.equal(element(overdueBoundary, 'freshness-label').textContent, 'Update overdue');
assert.match(element(overdueBoundary, 'freshness').getAttribute('title'), /\(11 days ago\)/);

const staleUpdate = structuredClone(publishedUpdates[0]);
staleUpdate.date = '2020-01-01';
const stale = await render({
  ok: true,
  status: 200,
  json: async () => [staleUpdate]
});
assertSettled(stale);
assert.deepEqual(stale.errors, []);
assert.equal(element(stale, 'freshness').dataset.freshness, 'overdue');
assert.equal(element(stale, 'freshness-label').textContent, 'Update overdue');

const markupPayload = '<img src=x onerror="alert(1)">';
const unsafeMarkup = structuredClone(publishedUpdates);
unsafeMarkup[0].title = markupPayload;
unsafeMarkup[0].body = `Observed text ${markupPayload}`;
unsafeMarkup[0].sources = [{ title: markupPayload, url: 'https://example.com/evidence' }];
const escapedMarkup = await render({
  ok: true,
  status: 200,
  json: async () => unsafeMarkup
});
const escapedUpdatesHtml = element(escapedMarkup, 'updates').innerHTML;
assertSettled(escapedMarkup);
assert.deepEqual(escapedMarkup.errors, []);
assert.equal(escapedUpdatesHtml.includes('<img'), false);
assert.equal(occurrences(escapedUpdatesHtml, '&lt;img'), 3);
assert.match(escapedUpdatesHtml, /href="https:\/\/example\.com\/evidence"/);

for (const mutate of [
  updates => { updates[0].score = 101; },
  updates => { updates[0].date = '2026-02-30'; },
  updates => { updates[0].sources[0].url = 'javascript:alert(1)'; },
  updates => { updates[1].date = updates[0].date; }
]) {
  const malformedUpdates = structuredClone(publishedUpdates);
  mutate(malformedUpdates);
  const malformed = await render({
    ok: true,
    status: 200,
    json: async () => malformedUpdates
  });
  assertSettled(malformed);
  assert.equal(malformed.errors.length, 1);
  assert.equal(element(malformed, 'score').textContent, '—');
  assert.equal(element(malformed, 'verdict').textContent, 'unavailable');
  assert.equal(element(malformed, 'week-title').textContent, 'Assessment temporarily unavailable');
}

const requestedDate = publishedUpdates.at(-1).date;
const deepLink = await render({
  ok: true,
  status: 200,
  json: async () => structuredClone(publishedUpdates)
}, `#update-${requestedDate}`);
assert.equal(element(deepLink, `update-${requestedDate}`).scrolledIntoView, true);

const malformedDeepLink = await render({
  ok: true,
  status: 200,
  json: async () => structuredClone(publishedUpdates)
}, '#update-%E0%A4%A');
assertSettled(malformedDeepLink);
assert.deepEqual(malformedDeepLink.errors, []);

const empty = await render({ ok: true, status: 200, json: async () => [] });
assertSettled(empty);
assert.deepEqual(empty.errors, []);
assert.equal(element(empty, 'score').textContent, '—');
assert.equal(element(empty, 'week-title').textContent, 'No assessment published yet');
assert.equal(element(empty, 'score-note').hidden, false);
assert.equal(element(empty, 'alignment-meter').getAttribute('aria-valuenow'), null);
assert.equal(element(empty, 'alignment-meter').getAttribute('aria-valuetext'), 'Assessment unavailable');
assert.equal(element(empty, 'freshness').dataset.freshness, 'unavailable');
assert.equal(element(empty, 'freshness-label').textContent, 'Update status unavailable');
assert.match(element(empty, 'updates').innerHTML, /View published updates/);

const unavailable = await render({
  ok: false,
  status: 503,
  json: async () => {
    throw new Error('Unexpected JSON read');
  }
});
assertSettled(unavailable);
assert.equal(unavailable.errors.length, 1);
assert.equal(element(unavailable, 'score').textContent, '—');
assert.equal(element(unavailable, 'verdict').textContent, 'unavailable');
assert.equal(element(unavailable, 'week-title').textContent, 'Assessment temporarily unavailable');
assert.match(element(unavailable, 'score-note').textContent, /could not be loaded/);
assert.match(element(unavailable, 'history').innerHTML, /could not be loaded/);

// Model Fetch's abort behavior at both asynchronous network boundaries.
for (const phase of ['response', 'body']) {
  const stalled = await render(null, '', undefined, async (url, { signal } = {}) => {
    const pending = () => new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    return phase === 'response' ? pending() : { ok: true, status: 200, json: pending };
  });
  assert.equal(stalled.errors.length, 0, phase);
  assert.equal(element(stalled, 'updates').getAttribute('aria-busy'), 'true', phase);
  assert.equal(stalled.timers.size, 1, phase);
  const timer = [...stalled.timers.values()][0];
  assert.equal(timer.delay, 15000, phase);
  const [url, { signal }] = stalled.requests[0];
  assert.equal(url, './data/updates.json');
  assert.equal(signal.aborted, false);
  timer.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signal.aborted, true, phase);
  assertSettled(stalled);
  assert.equal(stalled.errors.length, 1, phase);
  assert.equal(element(stalled, 'score').textContent, '—', phase);
  assert.equal(element(stalled, 'week-title').textContent, 'Assessment temporarily unavailable', phase);
  assert.equal(element(stalled, 'freshness').dataset.freshness, 'unavailable', phase);
  assert.match(element(stalled, 'updates').innerHTML, /View published updates/);
}

console.log('Runtime checks passed for success, source provenance and fallback, freshness boundaries, empty, unavailable, hostile, malformed, and stalled-network states');
