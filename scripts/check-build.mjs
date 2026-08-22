import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const versionedAssets = ['assets/styles.css', 'assets/resilience.css', 'assets/app.js'];
let failures = 0;

function fail(message) {
  console.error(`dist: ${message}`);
  failures++;
}

async function read(path) {
  try {
    return await readFile(join(dist, path));
  } catch {
    fail(`missing generated file: ${path}`);
    return null;
  }
}

const indexBuffer = await read('index.html');
const updatesBuffer = await read('data/updates.json');
const feedBuffer = await read('feed.xml');

if (indexBuffer) {
  const html = indexBuffer.toString('utf8');

  for (const asset of versionedAssets) {
    const escapedAsset = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...html.matchAll(new RegExp(`${escapedAsset}\\?v=([a-f0-9]{12})`, 'g'))];
    if (matches.length !== 1) {
      fail(`${asset} must have exactly one 12-character content version`);
      continue;
    }

    const contents = await read(asset);
    if (!contents) continue;
    const expected = createHash('sha256').update(contents).digest('hex').slice(0, 12);
    if (matches[0][1] !== expected) fail(`${asset} content version does not match its generated file`);
  }

  const localReferences = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)]
    .map(([, reference]) => reference)
    .filter(reference => !/^(?:https?:|data:)/.test(reference));

  for (const reference of new Set(localReferences)) {
    const path = reference.split(/[?#]/, 1)[0];
    if (path && !(await read(path))) fail(`broken local asset reference: ${reference}`);
  }

  for (const requiredMarkup of [
    '<main id="main-content" tabindex="-1">',
    '<nav aria-label="Primary navigation">',
    'role="progressbar" aria-label="Overall scenario alignment"',
    'aria-labelledby="timeline-heading"',
    'aria-labelledby="evidence-heading"',
    'aria-labelledby="method-heading"'
  ]) {
    if (!html.includes(requiredMarkup)) fail(`missing accessibility contract: ${requiredMarkup}`);
  }
}

if (updatesBuffer) {
  try {
    const updates = JSON.parse(updatesBuffer.toString('utf8'));
    const contentFiles = (await readdir(join(root, 'content/updates')))
      .filter(file => /^\d{4}-\d{2}-\d{2}\.md$/.test(file));

    if (!Array.isArray(updates)) fail('data/updates.json must contain an array');
    else {
      if (updates.length !== contentFiles.length) fail('generated update count does not match dated content files');
      const dates = updates.map(update => update.date);
      const sortedDates = [...dates].sort((a, b) => b.localeCompare(a));
      if (dates.some((date, index) => date !== sortedDates[index])) fail('updates must be newest first');
      if (updates.some(update => !Array.isArray(update.sources) || !update.sources.length)) {
        fail('every generated update must retain at least one source');
      }

      if (feedBuffer) {
        const feed = feedBuffer.toString('utf8');
        const entryCount = (feed.match(/<entry>/g) || []).length;
        if (!feed.startsWith('<?xml version="1.0" encoding="utf-8"?>')) fail('feed.xml must declare UTF-8 XML');
        if (!feed.includes('<feed xmlns="http://www.w3.org/2005/Atom">')) fail('feed.xml must be an Atom feed');
        if (entryCount !== updates.length) fail('feed entry count must match generated updates');
        if (!feed.includes(`<updated>${updates[0].date}T00:00:00Z</updated>`)) fail('feed updated date must match the latest assessment');
        for (const update of updates) {
          if (!feed.includes(`#update-${update.date}`)) fail(`feed is missing the ${update.date} assessment link`);
        }
      }
    }
  } catch {
    fail('data/updates.json is not valid JSON');
  }
}

if (failures) process.exit(1);
console.log(`Build checks passed for ${versionedAssets.length} versioned assets and the Atom feed`);
