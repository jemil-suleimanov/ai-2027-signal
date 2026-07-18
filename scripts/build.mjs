import { mkdir, readdir, readFile, rm, cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const contentDir = join(root, 'content/updates');
const dist = join(root, 'dist');

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
await mkdir(join(dist, 'data'), { recursive:true });
await writeFile(join(dist, 'data/updates.json'), JSON.stringify(updates, null, 2));
console.log(`Built ${updates.length} update(s) into dist/`);
