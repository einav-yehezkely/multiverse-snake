// Verifies that a built site directory is self-contained and uses only relative
// asset paths (required for GitHub Pages project URLs like /<repo>/).
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const root = resolve(process.argv[2] || '.');
const errors = [];
const html = readFileSync(join(root, 'index.html'), 'utf8');

const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:') && !u.startsWith('http'));
const clean = (u) => u.split('?')[0];
for (const r of [...refs, ...Object.values(map).filter((v) => !v.endsWith('/'))].map(clean)) {
  if (r.startsWith('/')) errors.push(`absolute path breaks on a project URL: ${r}`);
  if (!existsSync(join(root, r))) errors.push(`missing file referenced from index.html: ${r}`);
}
if (/(src|href)="https?:/.test(html)) errors.push('index.html references an external URL');

function resolveSpec(spec, from) {
  spec = spec.split('?')[0];
  if (spec.startsWith('.')) return resolve(dirname(from), spec);
  for (const [k, v] of Object.entries(map)) {
    if (k.endsWith('/') && spec.startsWith(k)) return resolve(root, v + spec.slice(k.length));
    if (spec === k) return resolve(root, v);
  }
  return null;
}
const seen = new Set();
function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!existsSync(file)) { errors.push(`missing module: ${relative(root, file)}`); return; }
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1] || m[2];
    const target = resolveSpec(spec, file);
    if (!target) errors.push(`unresolvable import "${spec}" in ${relative(root, file)}`);
    else walk(target);
  }
}
for (const m of html.matchAll(/<script type="module" src="([^"]+)"/g)) walk(resolve(root, m[1].split('?')[0]));

console.log(`checked ${seen.size} modules, ${refs.length} html refs`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('site OK');
