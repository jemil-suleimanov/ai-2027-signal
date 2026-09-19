import { mkdir, readdir, readFile, rm, cp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describeSource } from './source-provenance.mjs';

const root = new URL('..', import.meta.url).pathname;
const contentDir = join(root, 'content/updates');
const dist = join(root, 'dist');
const versionedAssets = ['assets/styles.css', 'assets/resilience.css', 'assets/app.js'];
const siteUrl = 'https://jemil-suleimanov.github.io/ai-2027-signal/';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeSourceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Static fallback source URL must be a valid HTTPS URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Static fallback source URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('Static fallback source URL must not contain credentials');
  }

  return value;
}

function formatAssessmentDate(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
}

function describeScoreChange(updates) {
  if (updates.length < 2) return 'First assessment';

  const delta = updates[0].score - updates[1].score;
  const previousDate = formatAssessmentDate(updates[1].date);
  if (delta === 0) return `No score change vs ${previousDate}`;

  const points = Math.abs(delta);
  return `${delta > 0 ? 'Up' : 'Down'} ${points} ${points === 1 ? 'point' : 'points'} vs ${previousDate}`;
}

function replaceOnce(html, before, after) {
  if (!html.includes(before)) throw new Error(`index.html: missing fallback marker: ${before}`);
  return html.replace(before, after);
}

async function injectStaticFallback(updates) {
  const indexPath = join(dist, 'index.html');
  const latest = updates[0];
  const archiveUrl = 'https://github.com/jemil-suleimanov/ai-2027-signal/tree/main/content/updates';
  const latestUrl = `https://github.com/jemil-suleimanov/ai-2027-signal/blob/main/content/updates/${latest.date}.md`;
  const trackNames = {
    capabilities: 'Model capabilities',
    automation: 'AI R&D automation',
    compute: 'Compute scale-up',
    geopolitics: 'Race dynamics'
  };
  let html = await readFile(indexPath, 'utf8');

  const replacements = [
    ['<span id="freshness-label" role="status" aria-live="polite">Checking update status</span>', `<span id="freshness-label" role="status" aria-live="polite">Assessment dated ${escapeHtml(formatAssessmentDate(latest.date))}</span>`],
    ['<span id="score">—</span>', `<span id="score">${escapeHtml(latest.score)}</span>`],
    ['<span id="verdict" class="pill">Loading</span>', `<span id="verdict" class="pill" data-verdict="${escapeHtml(latest.verdict)}">${escapeHtml(latest.verdict)}</span>`],
    ['<span id="confidence"></span>', `<span id="confidence">Evidence confidence: ${escapeHtml(latest.confidence)}</span>`],
    ['aria-valuemax="100" aria-valuetext="Loading"', `aria-valuemax="100" aria-valuenow="${escapeHtml(latest.score)}" aria-valuetext="${escapeHtml(latest.score)} out of 100 — ${escapeHtml(latest.verdict)}"`],
    ['<i id="meter"></i>', `<i id="meter" style="width:${escapeHtml(latest.score)}%"></i>`],
    ['<p id="score-note" role="status" aria-live="polite" aria-atomic="true" aria-busy="true">Loading the latest weekly assessment…</p>', `<p id="score-note" role="status" aria-live="polite" aria-atomic="true" aria-busy="false">Latest published summary; <a href="${latestUrl}">inspect this assessment in the public archive</a>.</p>`],
    ['<h2 id="week-title"></h2>', `<h2 id="week-title">${escapeHtml(latest.title)}</h2>`],
    ['<div class="model-callout"><span id="model"></span><p id="model-note"></p></div>', `<div class="model-callout"><span id="model">${escapeHtml(latest.model)}</span><p id="model-note">${escapeHtml(latest.model_note)}</p></div>`],
    ['<span id="updated" class="date"></span>', `<span id="updated" class="date">Assessment · ${escapeHtml(formatAssessmentDate(latest.date))} · ${escapeHtml(describeScoreChange(updates))}</span>`],
    ['<div class="marker scenario-marker"><span>Scenario</span><b id="scenario-marker"></b><small id="scenario-date"></small></div>', `<div class="marker scenario-marker"><span>Scenario</span><b id="scenario-marker">${escapeHtml(latest.scenario_marker)}</b><small id="scenario-date">${escapeHtml(latest.scenario_date)}</small></div>`],
    ['<div class="marker reality-marker"><span>Observed</span><b id="reality-marker"></b><small>as of latest update</small></div>', `<div class="marker reality-marker"><span>Observed</span><b id="reality-marker">${escapeHtml(latest.reality_marker)}</b><small>as of latest update</small></div>`],
    ['<div id="tracks" class="tracks" aria-live="polite" aria-busy="true"></div>', `<div id="tracks" class="tracks" aria-live="polite" aria-busy="false">${Object.entries(trackNames).map(([key, label]) => `
          <div class="track"><div><span>${label}</span><b>${escapeHtml(latest[key])}</b></div><div class="track-meter" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(latest[key])}" aria-valuetext="${escapeHtml(latest[key])} out of 100"><i style="width:${escapeHtml(latest[key])}%"></i></div></div>`).join('')}
        </div>`],
    ['<p id="history-summary">Loading assessment history…</p>', `<p id="history-summary">${updates.length} published assessments · ${escapeHtml(updates.at(-1).score)} → ${escapeHtml(latest.score)}</p>`],
    ['<div id="history" aria-live="polite" aria-busy="true"></div>', `<div id="history" aria-live="polite" aria-busy="false"><p class="history-note">The interactive chart requires JavaScript. <a href="${archiveUrl}">Browse all published assessments</a>.</p></div>`],
    ['<div id="updates" class="updates" aria-live="polite" aria-busy="true"></div>', `<div id="updates" class="updates" aria-live="polite" aria-busy="false">
          <article id="update-${escapeHtml(latest.date)}" class="update latest">
            <div class="update-meta"><time datetime="${escapeHtml(latest.date)}">${escapeHtml(latest.date)}</time><span>Latest signal</span></div>
            <div><h3>${escapeHtml(latest.title)}</h3>${latest.body.split('\n\n').map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}
              <div class="sources" aria-label="Sources">${latest.sources.map(source => `<a href="${escapeHtml(safeSourceUrl(source.url))}" target="_blank" rel="noreferrer"><span class="source-kind">${escapeHtml(source.kind)}</span><span>${escapeHtml(source.title)}<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in new tab)</span></span></a>`).join('')}</div>
            </div>
            <div class="mini-score"><b>${escapeHtml(latest.score)}</b><span>${escapeHtml(latest.verdict)}</span></div>
          </article>
        </div>`]
  ];

  for (const [before, after] of replacements) html = replaceOnce(html, before, after);
  await writeFile(indexPath, html);
}

function buildAtomFeed(updates) {
  const entries = updates.map(update => {
    const entryUrl = `${siteUrl}#update-${update.date}`;
    const published = `${update.date}T00:00:00Z`;

    return `  <entry>
    <title>${escapeXml(update.title)}</title>
    <link href="${escapeXml(entryUrl)}" />
    <id>${escapeXml(entryUrl)}</id>
    <published>${published}</published>
    <updated>${published}</updated>
    <summary>${escapeXml(`${update.score}/100 · ${update.verdict} · ${update.model_note}`)}</summary>
  </entry>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>AI 2027 Signal</title>
  <subtitle>Weekly evidence-led assessments of observed AI progress against the AI 2027 scenario.</subtitle>
  <link href="${siteUrl}feed.xml" rel="self" />
  <link href="${siteUrl}" />
  <id>${siteUrl}</id>
  <author><name>AI 2027 Signal</name></author>
  <updated>${updates[0].date}T00:00:00Z</updated>
${entries}
</feed>
`;
}

function buildSitemap(latestUpdate) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeXml(siteUrl)}</loc>
    <lastmod>${latestUpdate.date}</lastmod>
  </url>
</urlset>
`;
}

function buildRobotsTxt() {
  return `User-agent: *
Allow: /
Sitemap: ${siteUrl}sitemap.xml
`;
}

function buildStructuredData(latestUpdate) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'AI 2027 Signal',
    url: siteUrl,
    description: 'An independent weekly tracker comparing observed AI progress with the dated milestones and causal mechanisms in the AI 2027 scenario.',
    dateModified: latestUpdate.date,
    inLanguage: 'en',
    isAccessibleForFree: true,
    about: {
      '@type': 'Thing',
      name: 'AI 2027 scenario',
      url: 'https://ai-2027.com/'
    }
  };
}

async function injectStructuredData(latestUpdate) {
  const indexPath = join(dist, 'index.html');
  let html = await readFile(indexPath, 'utf8');
  const marker = '</head>';

  if (!html.includes(marker)) throw new Error('index.html: missing closing head tag');
  if (html.includes('type="application/ld+json"')) throw new Error('index.html: structured data already present');

  const structuredData = JSON.stringify(buildStructuredData(latestUpdate));
  html = html.replace(marker, `  <script type="application/ld+json">${structuredData}</script>\n${marker}`);
  await writeFile(indexPath, html);
}

async function injectUpdatesVersion(updatesJson) {
  const indexPath = join(dist, 'index.html');
  let html = await readFile(indexPath, 'utf8');
  const version = createHash('sha256').update(updatesJson).digest('hex').slice(0, 12);
  html = replaceOnce(
    html,
    '<meta name="updates-version" content="" />',
    `<meta name="updates-version" content="${version}" />`
  );
  await writeFile(indexPath, html);
}

async function versionAssetReferences() {
  const indexPath = join(dist, 'index.html');
  let html = await readFile(indexPath, 'utf8');

  for (const asset of versionedAssets) {
    const contents = await readFile(join(dist, asset));
    const version = createHash('sha256').update(contents).digest('hex').slice(0, 12);
    const escapedAsset = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reference = new RegExp(`${escapedAsset}(?:\\?v=[^"']+)?`, 'g');

    if (!html.includes(asset)) throw new Error(`index.html: missing ${asset} reference`);
    html = html.replace(reference, `${asset}?v=${version}`);
  }

  await writeFile(indexPath, html);
}

function parse(text, file) {
  text = text.replaceAll('\r\n', '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const meta = Object.fromEntries(match[1].split('\n').filter(Boolean).map(line => {
    const i = line.indexOf(':'); return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  }));
  for (const key of ['score','capabilities','automation','compute','geopolitics']) meta[key] = Number(meta[key]);
  meta.sources = (meta.sources || '').split(';').filter(Boolean).map(item => {
    const i = item.lastIndexOf('|');
    const url = item.slice(i + 1);
    return { title:item.slice(0, i), url, kind:describeSource(url) };
  });
  return { ...meta, body: match[2].trim() };
}

const files = (await readdir(contentDir)).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
const updates = await Promise.all(files.map(async f => parse(await readFile(join(contentDir, f), 'utf8'), f)));
updates.sort((a,b) => b.date.localeCompare(a.date));
const updatesJson = JSON.stringify(updates, null, 2);
await rm(dist, { recursive:true, force:true });
await mkdir(dist, { recursive:true });
await cp(join(root, 'public'), dist, { recursive:true });
await mkdir(join(dist, 'data'), { recursive:true });
await writeFile(join(dist, 'data/updates.json'), updatesJson);
await injectStructuredData(updates[0]);
await injectStaticFallback(updates);
await injectUpdatesVersion(updatesJson);
await versionAssetReferences();
await writeFile(join(dist, 'feed.xml'), buildAtomFeed(updates));
await writeFile(join(dist, 'sitemap.xml'), buildSitemap(updates[0]));
await writeFile(join(dist, 'robots.txt'), buildRobotsTxt());
console.log(`Built ${updates.length} update(s) into dist/`);
