import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
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
const sitemapBuffer = await read('sitemap.xml');
const robotsBuffer = await read('robots.txt');
const resilienceBuffer = await read('assets/resilience.css');

if (indexBuffer) {
  const html = indexBuffer.toString('utf8');

  const structuredDataMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (structuredDataMatches.length !== 1) {
    fail('index.html must contain exactly one JSON-LD block');
  } else {
    try {
      const structuredData = JSON.parse(structuredDataMatches[0][1]);
      if (structuredData['@context'] !== 'https://schema.org') fail('JSON-LD must use the schema.org context');
      if (structuredData['@type'] !== 'WebSite') fail('JSON-LD must describe the site as a WebSite');
      if (structuredData.url !== 'https://jemil-suleimanov.github.io/ai-2027-signal/') fail('JSON-LD URL must match the canonical site URL');
      if (structuredData.inLanguage !== 'en') fail('JSON-LD language must match the English site');
      if (structuredData.isAccessibleForFree !== true) fail('JSON-LD must describe the site as freely accessible');
    } catch {
      fail('index.html JSON-LD is not valid JSON');
    }
  }

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
    '<div id="freshness" class="eyebrow" data-freshness="unknown">',
    '<span id="freshness-label" role="status" aria-live="polite">Updated weekly</span>',
    '<a class="footer-link" href="https://github.com/jemil-suleimanov/ai-2027-signal" target="_blank" rel="noreferrer">Source on GitHub ↗</a>',
    '<a class="footer-link" href="feed.xml">Subscribe via RSS / Atom ↗</a>',
    'role="progressbar" aria-label="Overall scenario alignment"',
    'aria-labelledby="timeline-heading"',
    'aria-labelledby="evidence-heading"',
    'aria-labelledby="method-heading"'
  ]) {
    if (!html.includes(requiredMarkup)) fail(`missing accessibility contract: ${requiredMarkup}`);
  }
}

if (resilienceBuffer) {
  const css = resilienceBuffer.toString('utf8');
  if (!css.includes('@media (max-width: 780px)') || !css.includes('.nav nav {\n    display: flex;')) {
    fail('mobile primary navigation must remain visible');
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

      if (indexBuffer) {
        const html = indexBuffer.toString('utf8');
        const structuredDataMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        if (structuredDataMatch) {
          try {
            const structuredData = JSON.parse(structuredDataMatch[1]);
            if (structuredData.dateModified !== updates[0].date) {
              fail('JSON-LD modified date must match the latest assessment');
            }
          } catch {
            // Invalid JSON is reported with the index checks above.
          }
        }
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

      if (sitemapBuffer) {
        const sitemap = sitemapBuffer.toString('utf8');
        if (!sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) fail('sitemap.xml must declare UTF-8 XML');
        if (!sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')) fail('sitemap.xml must use the sitemap protocol namespace');
        if (!sitemap.includes('<loc>https://jemil-suleimanov.github.io/ai-2027-signal/</loc>')) fail('sitemap.xml must contain the canonical site URL');
        if (!sitemap.includes(`<lastmod>${updates[0].date}</lastmod>`)) fail('sitemap lastmod must match the latest assessment');
        if ((sitemap.match(/<url>/g) || []).length !== 1) fail('single-page sitemap must contain exactly one canonical URL');
        if (sitemap.includes('#update-')) fail('sitemap must not treat document fragments as separate pages');
      }

      if (robotsBuffer) {
        const robots = robotsBuffer.toString('utf8');
        if (robots !== 'User-agent: *\nAllow: /\nSitemap: https://jemil-suleimanov.github.io/ai-2027-signal/sitemap.xml\n') {
          fail('robots.txt must allow crawling and advertise the canonical sitemap');
        }
      }
    }
  } catch {
    fail('data/updates.json is not valid JSON');
  }
}

// The validator accepts LF and CRLF. Exercise the real builder in isolation to
// ensure platform line endings cannot change or prevent the published output.
const fixtureRoot = await mkdtemp(join(tmpdir(), 'ai-2027-format-'));
try {
  await mkdir(join(fixtureRoot, 'scripts'));
  await mkdir(join(fixtureRoot, 'content/updates'), { recursive: true });
  await cp(join(root, 'public'), join(fixtureRoot, 'public'), { recursive: true });
  await cp(join(root, 'scripts/build.mjs'), join(fixtureRoot, 'scripts/build.mjs'));
  await cp(join(root, 'scripts/check.mjs'), join(fixtureRoot, 'scripts/check.mjs'));
  const fixtureName = (await readdir(join(root, 'content/updates')))
    .filter(file => /^\d{4}-\d{2}-\d{2}\.md$/.test(file)).sort().at(-1);
  const lf = (await readFile(join(root, 'content/updates', fixtureName), 'utf8')).replaceAll('\r\n', '\n');
  const outputs = [];
  for (const text of [lf, lf.replaceAll('\n', '\r\n')]) {
    await writeFile(join(fixtureRoot, 'content/updates', fixtureName), text);
    await promisify(execFile)(process.execPath, [join(fixtureRoot, 'scripts/check.mjs')]);
    await promisify(execFile)(process.execPath, [join(fixtureRoot, 'scripts/build.mjs')]);
    outputs.push(await Promise.all(['data/updates.json', 'feed.xml', 'sitemap.xml', 'robots.txt', 'index.html']
      .map(file => readFile(join(fixtureRoot, 'dist', file), 'utf8'))));
  }
  if (outputs[0].some((output, index) => output !== outputs[1][index])) {
    fail('LF and CRLF content must produce identical generated output');
  }
} catch (error) {
  fail(`line-ending build regression: ${error.message}`);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

if (failures) process.exit(1);
console.log(`Build checks passed for ${versionedAssets.length} versioned assets, structured metadata, Atom feed, sitemap, and robots.txt`);
