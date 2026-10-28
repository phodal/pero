import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The website shares the App's existing pinned Three.js dependency.
if (!fs.existsSync(path.join(root, 'apps/virtual-cell/node_modules/three/package.json'))) {
  throw new Error('Install viewer dependencies first: npm ci --prefix apps/virtual-cell');
}
// Bundle the lightweight molecular illustration with the existing Three.js dependency.
const viewerOut = path.join(root, 'docs/assets/molecule-viewer');
await build({
  absWorkingDir: root, entryPoints: [path.join(root, 'pages/src/molecule-viewer.ts')],
  outfile: viewerOut + '.js', bundle: true, format: 'esm', platform: 'browser',
  minify: true, target: 'chrome120', jsx: 'automatic', legalComments: 'linked',
  supported: { 'template-literal': false },
  nodePaths: [path.join(root, 'apps/virtual-cell/node_modules')],

});
fs.writeFileSync(viewerOut + '.html', '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Molecular explorer</title><link rel="stylesheet" href="molecule-viewer.css"></head><body><div id="molecule-root"></div><script type="module" src="molecule-viewer.js"></script></body></html>');

const pages = path.join(root, 'pages');
const en = { ...require(path.join(pages, 'locales/en.js')), ...require(path.join(pages, 'locales/architecture.en.cjs')), ...require(path.join(pages, 'locales/cell.en.cjs')) };

const brandSvg = fs.readFileSync(path.join(pages, 'assets/openpero-mark.svg'), 'utf8').trim();
const brandSymbol = brandSvg.replace('<svg ', '<symbol id="i-openpero" ').replace(' fill="url(#openpero-ribbon-gradient)"', '').replace('</svg>', '</symbol>');
const brandDarkSvg = brandSvg.replace('fill="url(#openpero-ribbon-gradient)"', 'fill="url(#openpero-ribbon-gradient-dark)"');
const brandInline = (key, source = brandSvg) => source.replaceAll('openpero-ribbon-', 'openpero-' + key + '-');
const brandGradient = (start, end) => brandSvg.replace('stop-color="#007F86"', 'stop-color="' + start + '"').replace('stop-color="#55D5DD"', 'stop-color="' + end + '"');
const shell = fs.readFileSync(path.join(pages, 'src/index.html'), 'utf8').replace('__BRAND_SYMBOL__', brandSymbol);
const styles = ['styles.css', 'architecture.css', 'brand.css'].map((name) => fs.readFileSync(path.join(pages, 'src', name), 'utf8')).join('\n');
const cell = JSON.parse(fs.readFileSync(path.join(root, 'apps/virtual-cell/examples/synthetic.json'), 'utf8'));
// Embed the App fixture, retaining provenance and the exact frozen split.
const cellFixture = { dataset: cell.dataset, spec: cell.spec, split: cell.split };
const experiment = fs.readFileSync(path.join(pages, 'src/experiment.js'), 'utf8').replace('__CELL_FIXTURE__', JSON.stringify(cellFixture));
const demo = fs.readFileSync(path.join(pages, 'src/demo.js'), 'utf8');
const collab = fs.readFileSync(path.join(pages, 'src/collab.js'), 'utf8');

function extractCalls(src) {
  const keys = [];
  const names = ['tr', 'para', 'heading', 'item'];
  for (let i = 0; i < src.length; i++) {
    const name = names.find((candidate) => src.startsWith(candidate + '(', i));
    if (!name) continue;
    if (i > 0 && /[A-Za-z0-9_$]/.test(src[i - 1])) continue;
    let j = i + name.length + 1;
    while (src[j] === ' ' || src[j] === '\n') j++;
    const readString = () => {
      const quote = src[j];
      if (quote !== "'" && quote !== '"' && quote !== '`') return null;
      j++;
      let out = '';
      while (j < src.length) {
        if (src[j] === '\\') {
          const next = src[j + 1];
          out += next === 'n' ? '\n' : next;
          j += 2;
          continue;
        }
        if (src[j] === quote) {
          j++;
          return out;
        }
        out += src[j++];
      }
      return null;
    };
    const take = (value) => {
      if (value && /[\u4e00-\u9fff]/.test(value)) keys.push(value);
    };
    if (src[j] === "'" || src[j] === '"' || src[j] === '`') {
      take(readString());
    } else {
      let depth = 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "'" || src[j] === '"' || src[j] === '`') {
          take(readString());
          continue;
        }
        if (src[j] === '(') depth++;
        else if (src[j] === ')') depth--;
        j++;
      }
    }
  }
  return keys;
}

function markupStrings(html) {
  const withoutAssets = html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
  const found = [];
  const text = />([^<]*[\u4e00-\u9fff][^<]*)</g;
  const attrs = /="([^"]*[\u4e00-\u9fff][^"]*)"/g;
  let match;
  while ((match = text.exec(withoutAssets))) found.push(match[1].trim());
  while ((match = attrs.exec(withoutAssets))) found.push(match[1]);
  return found;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function translateMarkup(html, messages) {
  const missing = [];
  const apply = (source) => {
    const key = source.trim();
    if (!Object.prototype.hasOwnProperty.call(messages, key)) {
      missing.push(key);
      return null;
    }
    return messages[key];
  };
  let next = html.replace(/>([^<]*)</g, (full, text) => {
    if (!/[\u4e00-\u9fff]/.test(text)) return full;
    const translated = apply(text);
    if (translated == null) return full;
    return '>' + text.replace(text.trim(), escapeHtml(translated)) + '<';
  });
  next = next.replace(/="([^"]*)"/g, (full, value) => {
    if (!/[\u4e00-\u9fff]/.test(value)) return full;
    const translated = apply(value);
    if (translated == null) return full;
    return '="' + escapeHtml(translated) + '"';
  });
  return { html: next, missing };
}

function i18nRuntime(locale, messages) {
  const payload = JSON.stringify(messages).replace(/</g, '\\u003c');
  return `(function (root) {
  var messages = ${payload};
  function t(key, vars) {
    var value = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : key;
    if (vars) {
      value = String(value).replace(/\\{(\\w+)\\}/g, function (_, name) {
        return vars[name] == null ? '' : String(vars[name]);
      });
    }
    return value;
  }
  root.OpenPeroI18n = { locale: ${JSON.stringify(locale)}, t: t };
})(window);`;
}

function asReplacement(value) {
  return String(value).replaceAll('$', () => '$$');
}

function fill(html, locale) {
  const messages = locale === 'en' ? en : {};
  const runtime = i18nRuntime(locale, messages);
  return html
    .replaceAll('__HTML_LANG__', locale === 'en' ? 'en' : 'zh-CN')
    .replaceAll('__HREF_ZH__', locale === 'en' ? '../' : './')
    .replaceAll('__HREF_EN__', locale === 'en' ? './' : 'en/')
    .replaceAll('__LANG_HREF__', locale === 'en' ? '../' : 'en/')
    .replaceAll('__LANG_CODE__', locale === 'en' ? 'zh-CN' : 'en')
    .replaceAll('__LANG_LABEL__', locale === 'en' ? '中文' : 'English')
    .replaceAll('__MOLECULE_VIEWER__', locale === 'en' ? '../assets/molecule-viewer.html' : 'assets/molecule-viewer.html')
    .replaceAll('__FAVICON__', locale === 'en' ? '../favicon.svg' : 'favicon.svg')
    .replaceAll('__CANONICAL__', locale === 'en' ? 'https://phodal.github.io/pero/en/' : 'https://phodal.github.io/pero/')
    .replaceAll('__OG_LOCALE__', locale === 'en' ? 'en_US' : 'zh_CN')
    .replaceAll('__STYLES__', asReplacement(styles.trim()))
    .replaceAll('__I18N__', asReplacement(runtime))
    .replaceAll('__EXPERIMENT__', asReplacement(experiment.trim()))
    .replaceAll('__DEMO__', asReplacement(demo.trim()))
    .replaceAll('__COLLAB__', asReplacement(collab.trim()));
}

const required = new Set([
  ...extractCalls(demo),
  ...extractCalls(collab),
  ...markupStrings(shell)
]);
const missing = [...required].filter((key) => !Object.prototype.hasOwnProperty.call(en, key));
if (missing.length) {
  console.error('Missing English translations:\n' + missing.map((key) => JSON.stringify(key)).join('\n'));
  process.exit(1);
}

const chinese = fill(shell, 'zh-CN');
const translated = translateMarkup(shell, en);
if (translated.missing.length) {
  console.error('Untranslated markup:\n' + translated.missing.map((key) => JSON.stringify(key)).join('\n'));
  process.exit(1);
}
const english = fill(translated.html, 'en');
const englishMarkup = english.replace(/<script[\s\S]*?<\/script>/g, '');
const leftover = englishMarkup.match(/[\u4e00-\u9fff]+/g) || [];
const allowed = new Set(['中文']);
const unexpected = leftover.filter((token) => !allowed.has(token));
if (unexpected.length) {
  console.error('Chinese left in the English page:\n' + [...new Set(unexpected)].join('\n'));
  process.exit(1);
}

const docs = path.join(root, 'docs');
fs.mkdirSync(path.join(docs, 'en'), { recursive: true });
fs.writeFileSync(path.join(docs, 'index.html'), chinese);
fs.writeFileSync(path.join(docs, 'en/index.html'), english);
fs.writeFileSync(path.join(docs, 'favicon.svg'), brandSvg + '\n');
fs.writeFileSync(path.join(docs, '.nojekyll'), '');
const brandAssets = path.join(docs, 'assets');
fs.mkdirSync(brandAssets, { recursive: true });
fs.writeFileSync(path.join(brandAssets, 'openpero-mark.svg'), brandSvg + '\n');
fs.writeFileSync(path.join(brandAssets, 'openpero-mark-dark.svg'), brandDarkSvg + '\n');
const brandColors = [
  { key: 'teal', label: '青蓝渐变 · 推荐', start: '#007F86', end: '#55D5DD' },
  { key: 'purple', label: '蓝紫渐变', start: '#3B6FD8', end: '#845EC2' },
  { key: 'orange', label: '橙金渐变', start: '#B86A18', end: '#F2A65A' }
];
for (const { key, start, end } of brandColors) {
  fs.writeFileSync(path.join(brandAssets, `openpero-mark-${key}.svg`), brandGradient(start, end) + '\n');
}
fs.writeFileSync(path.join(brandAssets, 'openpero-mark-monochrome.svg'), brandSvg.replace('fill="url(#openpero-ribbon-gradient)"', 'fill="currentColor"') + '\n');
fs.writeFileSync(path.join(docs, 'brand-preview.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="favicon.svg" type="image/svg+xml"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenPero 配色预览</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#F7F9FC;color:#142B45;font-family:Inter,"Helvetica Neue",Arial,"PingFang SC",sans-serif}
main{max-width:800px;margin:24px auto;padding:0 24px}section{--mark:#007F86;padding:32px;border:1px solid #DCE4ED;background:#fff}
.reverse{--mark:#55D5DD;background:#142B45;color:#fff;border-color:#142B45}.caption{display:block;font-size:12px;letter-spacing:.06em;margin:0 0 20px;color:#596B7D}.reverse .caption{color:#ACBBCB}
.lockup{display:flex;align-items:center;gap:16px;font-size:48px;font-weight:650;letter-spacing:-.04em;line-height:1}.lockup svg{width:64px;height:64px;flex:none;color:var(--mark)}
.variants{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.variants section{padding:24px 20px;min-width:0}.variants .lockup{font-size:24px;gap:8px}.variants .lockup svg{width:32px;height:32px}
.sizes{display:flex;align-items:center;gap:32px;color:#007F86}.sample{display:flex;align-items:center;gap:8px;font-size:12px}.sample svg{flex:none}.sample span{color:#596B7D}
footer{display:flex;justify-content:space-between;gap:16px;padding:16px 0;font-size:12px}a{color:inherit}
@media(max-width:600px){.variants{grid-template-columns:1fr}.variants section{display:flex;justify-content:space-between;align-items:center;gap:12px}.variants .caption{margin:0}.variants .lockup{font-size:24px}}
@media(max-width:480px){main{margin:16px auto;padding:0 16px}section{padding:28px 20px}.lockup{font-size:36px;gap:12px}.lockup svg{width:48px;height:48px}.sizes{gap:20px}}
</style><main>
<section><p class="caption">青蓝渐变 × 深空蓝</p><div class="lockup">${brandInline("primary")}<span>OpenPero</span></div></section>
<section class="reverse"><p class="caption">深底 · 亮青渐变</p><div class="lockup">${brandInline("reverse", brandDarkSvg)}<span>OpenPero</span></div></section>
<div class="variants">${brandColors.map(({key,label,start,end}) => `<section><p class="caption">${label}</p><div class="lockup">${brandInline("variant-" + key, brandGradient(start, end))}<span>OpenPero</span></div></section>`).join('')}</div>
<section><p class="caption">小尺寸</p><div class="sizes">${[16,24,32].map(size => `<div class="sample">${brandInline("size-" + size).replace('<svg ', `<svg width="${size}" height="${size}" `)}<span>${size}px</span></div>`).join('')}</div></section>
<footer><span>三段环带 · 整体渐变</span><a href="assets/openpero-mark.svg">渐变 SVG</a></footer>
</main></html>`);
fs.writeFileSync(path.join(docs, 'preview.html'), `<!DOCTYPE html>
<html lang="zh-CN">
<meta charset="utf-8"/>
<link rel="icon" href="favicon.svg" type="image/svg+xml"/>
<meta http-equiv="refresh" content="0; url=./index.html"/>
<link rel="canonical" href="./index.html"/>
<title>OpenPero</title>
<p><a href="./index.html">OpenPero</a></p>
</html>
`);
console.log('Built docs/index.html and docs/en/index.html (' + required.size + ' strings).');
