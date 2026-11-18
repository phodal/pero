import fs from 'node:fs';
import path from 'node:path';
import english from '../locales/guide.en.mjs';
import chinese from '../locales/guide.zh-CN.mjs';

const navigationGroups = [
  ['overview', 'install', 'paper'],
  ['workflows', 'data', 'notebook', 'projects'],
  ['agents', 'compute', 'reference'],
];
const topics = navigationGroups.flat();
const overviewTopics = ['install', 'paper', 'workflows', 'agents'];

const locales = [
  {
    lang: 'zh-CN', directory: '', pages: chinese,
    docs: '文档', home: 'OpenPero 首页', skip: '跳到主要内容',
    contents: '本页目录', start: '从这里开始', dark: '深色模式',
    navigation: ['开始使用', '科研应用', '配置与参考'],
    languageName: '中文',
  },
  {
    lang: 'en', directory: 'en', pages: english,
    docs: 'Docs', home: 'OpenPero home', skip: 'Skip to content',
    contents: 'On this page', start: 'Start here', dark: 'Dark mode',
    navigation: ['Get started', 'Research Apps', 'Configuration and reference'],
    languageName: 'English',
  },
];

const route = (locale, topic) => path.posix.join(locale.directory, 'docs', topic === 'overview' ? '' : topic);
const directoryHref = (from, to) => `${path.posix.relative(from, to) || '.'}/`;

export function buildGuide(root, output, escapeHtml) {
  for (const topic of topics) {
    const sectionIds = chinese[topic].sections.map(({ id }) => id);
    if (new Set(sectionIds).size !== sectionIds.length ||
        sectionIds.join() !== english[topic].sections.map(({ id }) => id).join()) {
      throw new Error(`Duplicate or unmatched guide section identifiers in ${topic}`);
    }
  }

  const styles = [
    'packages/app-sdk/src/tokens/appearance.css',
    'packages/pero-design/src/tokens.generated.css',
    'pages/src/guide.css',
  ].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  fs.writeFileSync(path.join(output, 'assets/guide.css'), styles);

  for (const locale of locales) {
    const other = locales.find(({ lang }) => lang !== locale.lang);
    for (const topic of topics) {
      const page = locale.pages[topic];
      const folder = route(locale, topic);
      const home = directoryHref(folder, locale.directory || '.');
      const assets = directoryHref(folder, 'assets');
      const switchLanguage = directoryHref(folder, route(other, topic));
      const links = Object.fromEntries(topics.map((key) => [key, directoryHref(folder, route(locale, key))]));
      const navigation = navigationGroups.map((group, index) => `
      <div class="guide-nav-group">
        <p>${locale.navigation[index]}</p>
        <ul>
${group.map((key) => `          <li><a href="${links[key]}"${key === topic ? ' aria-current="page"' : ''}>${escapeHtml(locale.pages[key].label)}</a></li>`).join('\n')}
        </ul>
      </div>`).join('');
      const outline = topic !== 'overview' && page.sections.length > 1 ? `
    <nav class="guide-outline" aria-label="${locale.contents}">
      <p aria-hidden="true">${locale.contents}</p>
      <ul>
${page.sections.map(({ id, title }) => `        <li><a href="#${id}">${escapeHtml(title)}</a></li>`).join('\n')}
      </ul>
    </nav>` : '';
      const start = topic === 'overview' ? `
      <section class="guide-start" aria-labelledby="choose-task">
        <h2 id="choose-task">${locale.start}</h2>
        <ul>
${overviewTopics.map((key) => `          <li><a href="${links[key]}"><strong>${escapeHtml(locale.pages[key].label)}</strong><span>${escapeHtml(locale.pages[key].description)}</span></a></li>`).join('\n')}
        </ul>
      </section>` : '';
      const sections = page.sections.map(({ id, title, body }) => `
      <section aria-labelledby="${id}">
        <h2 id="${id}">${escapeHtml(title)}</h2>
        ${body.trim()}
      </section>`).join('\n').replace(/\{\{([a-z]+)\}\}/g, (_, key) => {
        if (key === 'assets') return assets;
        if (key === 'examples') return directoryHref(folder, 'examples');
        if (!Object.hasOwn(links, key)) throw new Error(`Unknown guide link ${key} in ${topic}`);
        return links[key];
      });
      const title = escapeHtml(page.title);
      const description = escapeHtml(page.description);
      const html = `<!doctype html>
<html lang="${locale.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${description}">
  <title>${title} · OpenPero</title>
  <link rel="icon" href="${assets}openpero-mark.svg" type="image/svg+xml">
  <link rel="canonical" href="https://openpero.com/${folder}/">
${locales.map((entry) => `  <link rel="alternate" hreflang="${entry.lang}" href="https://openpero.com/${route(entry, topic)}/">`).join('\n')}
  <script>
    let savedTheme;
    try { savedTheme = localStorage.getItem('pero-theme'); } catch {}
    document.documentElement.dataset.theme = savedTheme === 'dark' || savedTheme === 'light'
      ? savedTheme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  </script>
  <link rel="stylesheet" href="${assets}guide.css">
</head>
<body>
  <a class="guide-skip" href="#guide-main">${locale.skip}</a>
  <header class="guide-header">
    <div class="guide-shell guide-header-row">
      <a class="guide-brand" href="${home}" aria-label="${locale.home}"><img src="${assets}openpero-mark.svg" width="27" height="27" alt="">OpenPero</a>
      <span class="guide-header-label">${locale.docs}</span>
      <div class="guide-tools">
        <a class="guide-github" href="https://github.com/phodal/pero">GitHub</a>
        <a href="${switchLanguage}" hreflang="${other.lang}" lang="${other.lang}">${other.languageName}</a>
        <button type="button" id="guide-theme" aria-pressed="false" hidden>${locale.dark}</button>
      </div>
    </div>
  </header>
  <div class="guide-shell guide-layout">
    <nav class="guide-nav" aria-label="${locale.docs}">${navigation}
    </nav>
    <main id="guide-main" class="guide-main${outline ? ' guide-main-with-outline' : ''}" tabindex="-1" aria-labelledby="guide-title">
      <header class="guide-intro">
        <h1 id="guide-title">${title}</h1>
        <p>${description}</p>
      </header>${outline}
      <article class="guide-prose">${start}${sections}
      </article>
    </main>
  </div>
  <script>
    const languageLink = document.querySelector('.guide-tools a[hreflang]');
    const languageUrl = new URL(languageLink.href);
    const syncLanguage = () => {
      languageUrl.hash = location.hash;
      languageLink.href = languageUrl.href;
    };
    syncLanguage();
    window.addEventListener('hashchange', syncLanguage);

    const themeToggle = document.getElementById('guide-theme');
    const theme = document.documentElement.dataset;
    const syncTheme = () => themeToggle.setAttribute('aria-pressed', String(theme.theme === 'dark'));
    syncTheme();
    themeToggle.hidden = false;
    themeToggle.addEventListener('click', () => {
      theme.theme = theme.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('pero-theme', theme.theme); } catch {}
      syncTheme();
    });
  </script>
</body>
</html>
`;
      const target = path.join(output, folder);
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'index.html'), html);
    }
  }
}
