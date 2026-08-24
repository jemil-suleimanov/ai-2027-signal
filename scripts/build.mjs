import { mkdir, readdir, readFile, rm, cp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

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
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const meta = Object.fromEntries(match[1].split('\n').filter(Boolean).map(line => {
    const i = line.indexOf(':'); return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  }));
  for (const key of ['score','capabilities','automation','compute','geopolitics']) meta[key] = Number(meta[key]);
  meta.sources = (meta.sources || '').split(';').filter(Boolean).map(item => {
    const i = item.lastIndexOf('|'); return { title:item.slice(0,i), url:item.slice(i+1) };
  });
  return { ...meta, body: match[2].trim() };
}

const files = (await readdir(contentDir)).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
const updates = await Promise.all(files.map(async f => parse(await readFile(join(contentDir, f), 'utf8'), f)));
updates.sort((a,b) => b.date.localeCompare(a.date));
await rm(dist, { recursive:true, force:true });
await mkdir(dist, { recursive:true });
await cp(join(root, 'public'), dist, { recursive:true });
await injectStructuredData(updates[0]);
await versionAssetReferences();
await mkdir(join(dist, 'data'), { recursive:true });
await writeFile(join(dist, 'data/updates.json'), JSON.stringify(updates, null, 2));
await writeFile(join(dist, 'feed.xml'), buildAtomFeed(updates));
console.log(`Built ${updates.length} update(s) into dist/`);
