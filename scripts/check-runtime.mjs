import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const root = new URL('..', import.meta.url);
const appSource = await readFile(new URL('public/assets/app.js', root), 'utf8');
const publishedUpdates = JSON.parse(await readFile(new URL('dist/data/updates.json', root), 'utf8'));
const elementIds = [
  'score-note', 'tracks', 'history', 'updates', 'history-summary', 'score', 'verdict',
  'confidence', 'meter', 'alignment-meter', 'week-title', 'model', 'model-note',
  'updated', 'scenario-marker', 'scenario-date', 'reality-marker'
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

async function render(response, hash = '') {
  const updateIds = publishedUpdates.map(update => `update-${update.date}`);
  const elements = new Map([...elementIds, ...updateIds].map(id => [id, new FakeElement()]));
  for (const id of ['score-note', 'tracks', 'history', 'updates']) {
    elements.get(id).setAttribute('aria-busy', 'true');
  }
  elements.get('alignment-meter').setAttribute('aria-valuenow', '0');

  const errors = [];
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
    fetch: async () => response,
    location: { hash },
    URL
  };

  new Script(appSource, { filename: 'public/assets/app.js' }).runInNewContext(context);
  await new Promise(resolve => setImmediate(resolve));
  return { elements, errors };
}

function element(result, id) {
  return result.elements.get(id);
}

function assertSettled(result) {
  for (const id of ['score-note', 'tracks', 'history', 'updates']) {
    assert.equal(element(result, id).getAttribute('aria-busy'), 'false', `${id} should finish loading`);
  }
}

function occurrences(text, fragment) {
  return text.split(fragment).length - 1;
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
assert.match(element(success, 'updated').textContent, /^Assessment · .+ · (?:First assessment|No score change|Up|Down)/);
assert.equal(
  element(success, 'history-summary').textContent,
  `${publishedUpdates.length} published assessments · ${publishedUpdates.at(-1).score} → ${latest.score}`
);
assert.equal(occurrences(element(success, 'tracks').innerHTML, 'role="progressbar"'), 4);
assert.equal(occurrences(element(success, 'updates').innerHTML, 'class="update '), publishedUpdates.length);
assert.equal(occurrences(element(success, 'updates').innerHTML, 'class="source-kind"'), sourceCount);
assert.equal(element(success, 'updates').innerHTML.includes('Other source'), false);

const markupPayload = '<img src=x onerror="alert(1)">';
const unsafeMarkup = structuredClone(publishedUpdates);
unsafeMarkup[0].title = markupPayload;
unsafeMarkup[0].body = `Observed text ${markupPayload}`;
unsafeMarkup[0].sources = [{ title: markupPayload, url: 'javascript:alert(1)' }];
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
assert.match(escapedUpdatesHtml, /href="https:\/\/github\.com\/jemil-suleimanov\/ai-2027-signal\/tree\/main\/content\/updates"/);

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

console.log('Runtime checks passed for success, empty, and unavailable states');
