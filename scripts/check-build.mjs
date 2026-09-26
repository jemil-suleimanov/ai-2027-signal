import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { describeSource, sourceKinds } from './source-provenance.mjs';

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

  for (const fontHost of ['fonts.googleapis.com', 'fonts.gstatic.com']) {
    if (html.includes(fontHost)) fail(`index.html must not request fonts from ${fontHost}`);
  }

  const expectedContentSecurityPolicy = "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-src 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'";
  const contentSecurityPolicies = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/g)];
  if (contentSecurityPolicies.length !== 1 || contentSecurityPolicies[0][1] !== expectedContentSecurityPolicy) {
    fail('index.html must set exactly one approved Content Security Policy');
  }

  const referrerPolicies = [...html.matchAll(/<meta name="referrer" content="([^"]+)" \/>/g)];
  if (referrerPolicies.length !== 1 || referrerPolicies[0][1] !== 'no-referrer') {
    fail('index.html must set exactly one no-referrer policy');
  }

  const updatesVersions = [...html.matchAll(/<meta name="updates-version" content="([a-f0-9]{12})" \/>/g)];
  if (updatesVersions.length !== 1) {
    fail('index.html must contain exactly one 12-character assessment-data version');
  } else if (updatesBuffer) {
    const expected = createHash('sha256').update(updatesBuffer).digest('hex').slice(0, 12);
    if (updatesVersions[0][1] !== expected) {
      fail('assessment-data version must match data/updates.json contents');
    }
  }

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
    '<span id="freshness-label" role="status" aria-live="polite">',
    '<a class="source-link" href="https://ai-2027.com/" target="_blank" rel="noreferrer">Read the scenario<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in new tab)</span></a>',
    '<a class="footer-link" href="https://github.com/jemil-suleimanov/ai-2027-signal" target="_blank" rel="noreferrer">Source on GitHub<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in new tab)</span></a>',
    'public assessment archive · <a class="footer-link" href="feed.xml">Subscribe via RSS / Atom ↗</a>',
    'role="progressbar" aria-label="Overall scenario alignment"',
    'aria-labelledby="timeline-heading"',
    'aria-labelledby="evidence-heading"',
    'Publisher labels describe provenance, not claim truth; the text distinguishes lab-reported claims, independent evidence and editorial inference.',
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
      if (updates.some(update => update.sources.some(source => !sourceKinds.includes(source.kind)))) {
        fail('every generated source must have a known provenance label');
      }

      if (indexBuffer) {
        const html = indexBuffer.toString('utf8');
        const latest = updates[0];
        for (const fallback of [
          `<span id="score">${latest.score}</span>`,
          `<span id="verdict" class="pill" data-verdict="${latest.verdict}">${latest.verdict}</span>`,
          '<span id="freshness-label" role="status" aria-live="polite">Assessment dated ',
          `aria-valuenow="${latest.score}" aria-valuetext="${latest.score} out of 100 — ${latest.verdict}"`,
          `id="update-${latest.date}" class="update latest"`,
          `aria-labelledby="update-title-${latest.date}"`,
          `<h3 id="update-title-${latest.date}">`,
          'Latest published summary;',
          'aria-live="polite" aria-busy="false"'
        ]) {
          if (!html.includes(fallback)) fail(`generated HTML is missing static fallback: ${fallback}`);
        }
        if (html.includes('Loading the latest weekly assessment…')) {
          fail('generated HTML must not leave the latest assessment in a loading state');
        }
        const fallbackSourceKinds = (html.match(/class="source-kind"/g) || []).length;
        if (fallbackSourceKinds !== latest.sources.length) {
          fail('static fallback must label every latest-assessment source');
        }
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
  await cp(join(root, 'scripts/source-provenance.mjs'), join(fixtureRoot, 'scripts/source-provenance.mjs'));
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

  for (const [url, expectedKind] of [
    ['https://ai-2027.com/', 'Scenario reference'],
    ['https://www.cisa.gov/news-events/cybersecurity-advisories/example', 'Government source'],
    ['https://metr.org/time-horizons/', 'Independent research'],
    ['https://www.reuters.com/technology/', 'News reporting'],
    ['https://arxiv.org/abs/example', 'Research paper'],
    ['https://www.anthropic.com/news/example', 'First-party'],
    ['https://example.org/new-publisher', 'Other source'],
    ['https://cisa.gov.example.org/advisory', 'Other source'],
    ['https://reuters.com.example.org/report', 'Other source'],
    ['https://example.org/reuters.com', 'Other source']
  ]) {
    if (describeSource(url) !== expectedKind) {
      fail(`source provenance mismatch for ${url}`);
    }
  }

  const hostileMarkup = '<img src=x onerror=alert(1)>';
  const hostileUpdate = lf.replace(/^title:\s*(.+)$/m, `title: ${hostileMarkup}`);
  await writeFile(join(fixtureRoot, 'content/updates', fixtureName), hostileUpdate);
  await promisify(execFile)(process.execPath, [join(fixtureRoot, 'scripts/build.mjs')]);
  const hostileHtml = await readFile(join(fixtureRoot, 'dist/index.html'), 'utf8');
  if (hostileHtml.includes(hostileMarkup)) {
    fail('static fallback must not render editorial text as HTML');
  }
  if (!hostileHtml.includes('&lt;img src=x onerror=alert(1)&gt;')) {
    fail('static fallback must retain escaped editorial text');
  }

  const sourceLine = lf.match(/^sources:\s*(.+)$/m)?.[1] || '';
  const firstSource = sourceLine.split(';')[0];
  const firstSourceUrl = firstSource.slice(firstSource.lastIndexOf('|') + 1);
  const firstHost = new URL(firstSourceUrl).hostname;
  const equivalentUrl = firstSourceUrl.replace(firstHost, firstHost.toUpperCase());
  const duplicateSource = lf.replace(/^sources:\s*(.+)$/m, `$&;Equivalent duplicate|${equivalentUrl}`);
  await writeFile(join(fixtureRoot, 'content/updates', fixtureName), duplicateSource);
  try {
    await promisify(execFile)(process.execPath, [join(fixtureRoot, 'scripts/check.mjs')]);
    fail('content validation must reject canonically equivalent source URLs');
  } catch (error) {
    if (!String(error.stderr).includes('duplicate source URL')) {
      fail(`equivalent source regression failed unexpectedly: ${error.message}`);
    }
  }

  const credentialSource = lf.replace(firstSourceUrl, 'https://editor:secret@example.com/evidence');
  await writeFile(join(fixtureRoot, 'content/updates', fixtureName), credentialSource);
  try {
    await promisify(execFile)(process.execPath, [join(fixtureRoot, 'scripts/check.mjs')]);
    fail('content validation must reject source URLs containing credentials');
  } catch (error) {
    if (!String(error.stderr).includes('source URL must not contain credentials')) {
      fail(`credential source regression failed unexpectedly: ${error.message}`);
    }
  }

  await writeFile(join(fixtureRoot, 'content/updates', fixtureName), credentialSource);
  try {
    await promisify(execFile)(process.execPath, [join(fixtureRoot, 'scripts/build.mjs')]);
    fail('static fallback builder must reject source URLs containing credentials');
  } catch (error) {
    if (!String(error.stderr).includes('Static fallback source URL must not contain credentials')) {
      fail(`static fallback credential regression failed unexpectedly: ${error.message}`);
    }
  }

  const insecureSource = lf.replace(firstSourceUrl, 'http://example.com/evidence');
  await writeFile(join(fixtureRoot, 'content/updates', fixtureName), insecureSource);
  try {
    await promisify(execFile)(process.execPath, [join(fixtureRoot, 'scripts/check.mjs')]);
    fail('content validation must reject source URLs without HTTPS');
  } catch (error) {
    if (!String(error.stderr).includes('source URL must use HTTPS')) {
      fail(`insecure source regression failed unexpectedly: ${error.message}`);
    }
  }

  await writeFile(join(fixtureRoot, 'content/updates', fixtureName), insecureSource);
  try {
    await promisify(execFile)(process.execPath, [join(fixtureRoot, 'scripts/build.mjs')]);
    fail('static fallback builder must reject source URLs without HTTPS');
  } catch (error) {
    if (!String(error.stderr).includes('Static fallback source URL must use HTTPS')) {
      fail(`static fallback URL regression failed unexpectedly: ${error.message}`);
    }
  }

  const futureDate = '9999-12-31';
  const futureName = `${futureDate}.md`;
  const futureUpdate = lf.replace(/^date:\s*\d{4}-\d{2}-\d{2}$/m, `date: ${futureDate}`);
  await rm(join(fixtureRoot, 'content/updates', fixtureName), { force: true });
  await writeFile(join(fixtureRoot, 'content/updates', futureName), futureUpdate);
  try {
    await promisify(execFile)(process.execPath, [join(fixtureRoot, 'scripts/check.mjs')]);
    fail('content validation must reject future-dated updates');
  } catch (error) {
    if (!String(error.stderr).includes('date must not be in the future')) {
      fail(`future date regression failed unexpectedly: ${error.message}`);
    }
  }
} catch (error) {
  fail(`line-ending build regression: ${error.message}`);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

if (failures) process.exit(1);
console.log(`Build checks passed for ${versionedAssets.length} versioned assets, structured metadata, Atom feed, sitemap, and robots.txt`);
