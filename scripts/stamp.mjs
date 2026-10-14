// Cache-busting for GitHub Pages (which serves everything with max-age=600):
// appends ?v=<version> to the stylesheet, the entry script, and every relative
// module import under src/, so a new release never mixes with stale cached files.
// Usage: node scripts/stamp.mjs <siteDir> <version>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [dir, version] = process.argv.slice(2);
if (!dir || !version) { console.error('usage: stamp.mjs <siteDir> <version>'); process.exit(1); }
const v = encodeURIComponent(version);

const htmlPath = join(dir, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
html = html.replace(/(href="css\/[^"?]+\.css)"/g, `$1?v=${v}"`).replace(/(src="src\/[^"?]+\.js)"/g, `$1?v=${v}"`);
writeFileSync(htmlPath, html);

let n = 0;
for (const f of readdirSync(join(dir, 'src'))) {
  if (!f.endsWith('.js')) continue;
  const p = join(dir, 'src', f);
  const src = readFileSync(p, 'utf8').replace(/(['"])(\.\.?\/[^'"?]+\.js)\1/g, (m, q, spec) => { n++; return `${q}${spec}?v=${v}${q}`; });
  writeFileSync(p, src);
}
console.log(`stamped index.html and ${n} module imports with v=${version}`);
