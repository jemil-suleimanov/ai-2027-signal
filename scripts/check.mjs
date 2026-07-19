import { readdir, readFile } from 'node:fs/promises';

const dir = new URL('../content/updates/', import.meta.url);
const required = ['date','title','score','verdict','confidence','capabilities','automation','compute','geopolitics','model','model_note','scenario_marker','scenario_date','reality_marker','sources'];
const scoreFields = ['score','capabilities','automation','compute','geopolitics'];
const verdicts = new Set(['materially behind','behind','near','ahead','materially ahead']);
const confidenceLevels = new Set(['low','medium','high']);
let failures = 0;

function fail(file, message) {
  console.error(`${file}: ${message}`);
  failures++;
}

function parseFrontmatter(text, file) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    fail(file, 'missing or malformed frontmatter');
    return null;
  }

  const meta = {};
  for (const line of match[1].split(/\r?\n/).filter(Boolean)) {
    const separator = line.indexOf(':');
    if (separator < 1) {
      fail(file, `malformed frontmatter line: ${line}`);
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (Object.hasOwn(meta, key)) fail(file, `duplicate ${key} field`);
    meta[key] = value;
  }

  return { meta, body: match[2].trim() };
}

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateSources(value, file) {
  const sources = value.split(';').map(source => source.trim()).filter(Boolean);
  if (!sources.length) {
    fail(file, 'sources must contain at least one citation');
    return;
  }

  const seenUrls = new Set();
  for (const source of sources) {
    const separator = source.lastIndexOf('|');
    const title = source.slice(0, separator).trim();
    const rawUrl = separator >= 0 ? source.slice(separator + 1).trim() : '';

    if (!title || !rawUrl) {
      fail(file, `invalid source entry: ${source}`);
      continue;
    }

    try {
      const url = new URL(rawUrl);
      if (!['http:', 'https:'].includes(url.protocol)) fail(file, `unsupported source URL protocol: ${rawUrl}`);
    } catch {
      fail(file, `invalid source URL: ${rawUrl}`);
    }

    if (seenUrls.has(rawUrl)) fail(file, `duplicate source URL: ${rawUrl}`);
    seenUrls.add(rawUrl);
  }
}

const files = (await readdir(dir)).filter(file => file !== '_template.md' && file.endsWith('.md')).sort();
if (!files.length) fail('content/updates', 'no dated updates found');

const seenDates = new Set();
for (const file of files) {
  const text = await readFile(new URL(file, dir), 'utf8');
  const parsed = parseFrontmatter(text, file);
  if (!parsed) continue;

  const { meta, body } = parsed;
  for (const field of required) if (!meta[field]) fail(file, `missing ${field}`);

  for (const field of scoreFields) {
    if (!meta[field]) continue;
    if (!/^-?\d+$/.test(meta[field]) || !Number.isInteger(Number(meta[field]))) {
      fail(file, `${field} must be an integer`);
    } else if (Number(meta[field]) < 0 || Number(meta[field]) > 100) {
      fail(file, `${field} must be between 0 and 100`);
    }
  }

  if (meta.date) {
    if (!isRealDate(meta.date)) fail(file, `invalid date: ${meta.date}`);
    if (file !== `${meta.date}.md`) fail(file, `filename must match date (${meta.date}.md)`);
    if (seenDates.has(meta.date)) fail(file, `duplicate update date: ${meta.date}`);
    seenDates.add(meta.date);
  }

  if (meta.verdict && !verdicts.has(meta.verdict)) fail(file, `invalid verdict: ${meta.verdict}`);
  if (meta.confidence && !confidenceLevels.has(meta.confidence)) fail(file, `invalid confidence: ${meta.confidence}`);
  if (meta.sources) validateSources(meta.sources, file);
  if (!body) fail(file, 'editorial body must not be empty');
}

if (failures) process.exit(1);
console.log(`Content checks passed for ${files.length} update(s)`);
