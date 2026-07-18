import { readdir, readFile } from 'node:fs/promises';
const dir = new URL('../content/updates/', import.meta.url);
const required = ['date','title','score','verdict','confidence','capabilities','automation','compute','geopolitics','model','model_note','scenario_marker','scenario_date','reality_marker','sources'];
let failures = 0;
for (const file of (await readdir(dir)).filter(f => /^\d.*\.md$/.test(f))) {
  const text = await readFile(new URL(file, dir), 'utf8');
  for (const field of required) if (!new RegExp(`^${field}:\\s*.+$`, 'm').test(text)) { console.error(`${file}: missing ${field}`); failures++; }
  for (const score of [...text.matchAll(/^(score|capabilities|automation|compute|geopolitics):\s*(\d+)/gm)]) if (+score[2] > 100) { console.error(`${file}: ${score[1]} exceeds 100`); failures++; }
  for (const url of [...text.matchAll(/\|(https?:\/\/[^;\n]+)/g)]) try { new URL(url[1]); } catch { console.error(`${file}: invalid URL`); failures++; }
}
if (failures) process.exit(1);
console.log('Content checks passed');
