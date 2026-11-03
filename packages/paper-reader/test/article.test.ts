import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { Article } from '../src/article.ts';

const window = new JSDOM('').window as unknown as Window & typeof globalThis;
const cases = [
  { name: 'retains scientific structure and anchors', html: `<article class="ltx_document"><section id="S1"><h2>1 <em>Introduction</em></h2><ul><li><span>•</span>\n<p>A <strong>contribution</strong>.</p><ol><li>Nested</li></ol></li></ul><math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>x</mi><mn>2</mn></mfrac></math><table><tr><th colspan="2">Measure</th></tr><tr><td>1</td><td>kg</td></tr></table><a href="#S1">Section 1</a></section></article>`, check(a: Article) {
    assert.deepEqual(a.outline, [{ id: 'S1', title: '1 Introduction', level: 2 }]);
    assert.ok(a.body.querySelector('ul > li > ol > li'));
    assert.equal(a.body.querySelector('strong')?.textContent, 'contribution');
    assert.ok(a.body.querySelector('math mfrac'));
    assert.equal(a.body.querySelector('th')?.getAttribute('colspan'), '2');
    assert.equal(a.body.querySelector('a')?.getAttribute('href'), 'https://arxiv.org/html/1234.56789v1#S1');
  } },
  { name: 'does not activate content or fetch original resources', html: `<article><h1>Paper</h1><script>alert(1)</script><form><input></form><p onclick="bad()" style="background:url(https://example.com/tracker)">Text</p><img src="image.png" srcset="other.png 2x" alt="Plot not downloaded"><a href="javascript:alert(1)">bad link</a><svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x"/></svg></article>`, check(a: Article) {
    assert.equal(a.body.querySelector('script,form,input,[onclick],[style],[srcset],[src]'), null);
    assert.equal(a.body.querySelector('a')?.getAttribute('href'), null);
    assert.equal(a.body.querySelector('image')?.getAttribute('href'), null);
    assert.equal(a.body.querySelector('.reader-missing-image')?.textContent, 'Image not downloaded: Plot not downloaded');
  } },
  { name: 'uses only caller supplied image assets', html: '<article><figure><img src="plot.png"><figcaption>Measured result</figcaption></figure></article>', check(a: Article) {
    assert.equal(a.body.querySelector('img')?.getAttribute('src'), 'blob:https://app.test/plot');
    assert.equal(a.body.querySelector('figcaption')?.textContent, 'Measured result');
  } },
];
for (const { name, html, check } of cases) test(name, () => {
  const source = { id: 'frozen-snapshot', html, sourceUrl: 'https://arxiv.org/html/1234.56789v1', assets: new Map([['https://arxiv.org/html/plot.png', 'blob:https://app.test/plot']]) };
  check(new Article(window, source));
  assert.equal(source.html, html);
});
