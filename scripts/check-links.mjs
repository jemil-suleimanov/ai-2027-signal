import { readdir, readFile } from 'node:fs/promises';

const updatesDir = new URL('../content/updates/', import.meta.url);
const timeoutMs = 12_000;
const concurrency = 4;
const userAgent = 'AI-2027-Signal-Link-Check/1.0 (+https://jemil-suleimanov.github.io/ai-2027-signal/)';
const hardNetworkErrors = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ENOTFOUND',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
]);

function getSourceUrls(text) {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return [];

  const sourcesLine = frontmatter[1]
    .split(/\r?\n/)
    .find(line => line.startsWith('sources:'));
  if (!sourcesLine) return [];

  return sourcesLine
    .slice('sources:'.length)
    .split(';')
    .map(source => source.slice(source.lastIndexOf('|') + 1).trim())
    .filter(Boolean);
}

async function request(url, method) {
  const headers = { 'User-Agent': userAgent };
  if (method === 'GET') headers.Range = 'bytes=0-0';

  return fetch(url, {
    method,
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function checkUrl(url) {
  let response;
  try {
    response = await request(url, 'HEAD');
    if ([404, 405, 410, 501].includes(response.status)) {
      response = await request(url, 'GET');
    }
  } catch (firstError) {
    try {
      response = await request(url, 'GET');
    } catch (secondError) {
      const code = secondError.cause?.code || firstError.cause?.code;
      const timedOut = secondError.name === 'TimeoutError' || firstError.name === 'TimeoutError';
      return {
        kind: !timedOut && hardNetworkErrors.has(code) ? 'broken' : 'indeterminate',
        detail: timedOut ? 'timed out twice' : `network error${code ? ` (${code})` : ''}`,
      };
    }
  }

  const status = response.status;
  if (status >= 200 && status < 400) return { kind: 'ok', detail: `${status}` };
  if ([404, 410].includes(status)) return { kind: 'broken', detail: `${status}` };
  if ([401, 403, 405, 408, 425, 429].includes(status) || status >= 500) {
    return { kind: 'indeterminate', detail: `${status}` };
  }
  return { kind: 'indeterminate', detail: `${status}` };
}

async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

const files = (await readdir(updatesDir))
  .filter(file => file !== '_template.md' && file.endsWith('.md'))
  .sort();
const urls = new Set();

for (const file of files) {
  const text = await readFile(new URL(file, updatesDir), 'utf8');
  for (const url of getSourceUrls(text)) urls.add(url);
}

const uniqueUrls = [...urls].sort();
if (!uniqueUrls.length) {
  console.error('No source URLs found');
  process.exit(1);
}

console.log(`Checking ${uniqueUrls.length} unique source URL(s)...`);
const results = await mapWithConcurrency(uniqueUrls, async url => ({
  url,
  ...(await checkUrl(url)),
}));

for (const result of results) {
  const label = result.kind === 'ok' ? 'OK' : result.kind === 'broken' ? 'BROKEN' : 'WARN';
  console.log(`${label.padEnd(6)} ${result.detail.padEnd(22)} ${result.url}`);
}

const broken = results.filter(result => result.kind === 'broken');
const indeterminate = results.filter(result => result.kind === 'indeterminate');
console.log(
  `Link check complete: ${results.length - broken.length - indeterminate.length} reachable, ` +
  `${indeterminate.length} indeterminate, ${broken.length} broken.`,
);

if (broken.length) process.exit(1);
