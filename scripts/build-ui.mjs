// Bundles each MCP App in ui/ into one self-contained HTML file in ui-dist/.
//
//   node scripts/build-ui.mjs
//
// An app is ui/<name>.html (markup, with {{STYLE}}, {{LOGO}} and {{SCRIPT}} placeholders) plus ui/<name>.ts
// (its script). The brush engine is vendored verbatim in ui/vendor/brush-engine.js; the 'brush-core' module the
// scripts import is that file with its page glue cut off, wrapped in a function that takes the brush config.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = path.join(root, 'ui');
const out = path.join(root, 'ui-dist');
const APPS = ['stroke-player', 'compass'];

// The engine declares the stroke data S and CFG before it, builds the strokes at `const strokes=S.map(build)`,
// and everything after that line is the sample page's player. Keep the part before it.
const engine = fs.readFileSync(path.join(ui, 'vendor', 'brush-engine.js'), 'utf8');
const cut = engine.indexOf('const strokes=S.map(build);');
if (cut < 0) throw new Error('brush-engine.js no longer has the marker "const strokes=S.map(build);"; update scripts/build-ui.mjs');
const brushCore = `export function createBrush(CFG){\n${engine.slice(0, cut)}\nreturn {build,renderStroke,INK,INK_EDGE,dispose:()=>probe.remove()};\n}\n`;

const brushPlugin = {
  name: 'brush-core',
  setup(b) {
    b.onResolve({ filter: /^brush-core$/ }, () => ({ path: 'brush-core', namespace: 'brush' }));
    b.onLoad({ filter: /.*/, namespace: 'brush' }, () => ({ contents: brushCore, loader: 'js' }));
  },
};

const style = fs.readFileSync(path.join(ui, 'common.css'), 'utf8');
const logo = fs
  .readFileSync(path.join(ui, 'vendor', 'nihongoism-logo.svg'), 'utf8')
  .replace(/^<\?xml[^>]*\?>/, '')
  .trim();

const footer = fs.readFileSync(path.join(ui, 'footer.html'), 'utf8').replace('{{LOGO}}', () => logo);

fs.mkdirSync(out, { recursive: true });
for (const name of APPS) {
  const result = await build({
    entryPoints: [path.join(ui, `${name}.ts`)],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    minify: true,
    plugins: [brushPlugin],
    legalComments: 'none',
  });
  const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = fs
    .readFileSync(path.join(ui, `${name}.html`), 'utf8')
    .replace('{{STYLE}}', () => style)
    .replace('{{FOOTER}}', () => footer)
    .replace('{{LOGO}}', () => logo)
    .replace('{{SCRIPT}}', () => script);
  fs.writeFileSync(path.join(out, `${name}.html`), html, 'utf8');
  console.log(`ui-dist/${name}.html  ${(html.length / 1024).toFixed(0)} KB`);
}
