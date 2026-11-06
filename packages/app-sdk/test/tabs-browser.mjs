// Exercise clipped scroll strips in a real renderer; jsdom has no outline geometry.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const sdk = resolve(import.meta.dirname, '..');
let browser, script;
before(async () => {
  const built = await build({
    stdin: { resolveDir: sdk, loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { Tabs, TabsList, TabsTrigger, ContentTab, TabsContent } from './src/components/tabs';
      import { Checkbox } from './src/components/checkbox';
      const ids = ['First document', 'Second document', 'Third document', 'Fourth document'];
      createRoot(document.getElementById('app')).render(<>
        {['page', 'content'].map(variant => <Tabs key={variant} defaultValue={ids[0]}>
          <TabsList aria-label={variant} variant={variant} style={{width:260}}>
            {ids.map(id => variant === 'content'
              ? <ContentTab key={id} value={id} label={id} closeLabel="Close" leading={<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor"/></svg>} onClose={() => {}}/>
              : <TabsTrigger key={id} value={id}>{id}</TabsTrigger>)}
          </TabsList>
          {ids.map(id => <TabsContent key={id} value={id}>{variant}: {id}</TabsContent>)}
        </Tabs>)}
        <Checkbox aria-label="Keep outside focus"/>
      </>);` },
    bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
  });
  script = built.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

for (const size of [14, 24]) test(`scrolling page and content tabs keep the whole focus ring visible at ${size}px`, async t => {
  const page = await browser.newPage({viewport:{width:360,height:600}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.route('http://tabs.test/**', route => route.fulfill({
    contentType: route.request().url().endsWith('ui.js') ? 'text/javascript' : 'text/html',
    body: route.request().url().endsWith('ui.js') ? script : `<!doctype html><html data-theme="${size===24?'dark':'light'}"><head><style>:root {--pero-font-scale:${size/14};--pero-focus-ring-width:4px} body {margin:20px;background:var(--pero-bg);color:var(--pero-text)}</style></head><body><div id="app"></div><script type="module" src="/ui.js"></script></body></html>`,
  }));
  await page.goto('http://tabs.test/');
  for (const variant of ['page', 'content']) {
    const list = page.getByRole('tablist',{name:variant,exact:true});
    await list.getByRole('tab').first().focus();
    await page.keyboard.press('End');
    const last = list.getByRole('tab').last();
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute('aria-selected','true');
    await expect.poll(() => list.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    const ring = await last.evaluate(node => {
      const tab=node.getBoundingClientRect(), list=node.closest('[role=tablist]').getBoundingClientRect(), css=getComputedStyle(node);
      const outset=parseFloat(css.outlineWidth)+parseFloat(css.outlineOffset);
      // Browser scroll offsets round to device pixels while tab text has fractional widths.
      const tolerance=1/devicePixelRatio;
      return {style:css.outlineStyle,width:parseFloat(css.outlineWidth),outset,tab:tab.toJSON(),list:list.toJSON(),visible:tab.left-outset>=list.left-tolerance&&tab.right+outset<=list.right+tolerance&&tab.top-outset>=list.top-tolerance&&tab.bottom+outset<=list.bottom+tolerance};
    });
    assert.equal(ring.style,'solid');
    assert.equal(ring.width,4,'uses the configured focus ring width');
    assert.equal(ring.visible,true,`${variant} ring stays inside the scroll viewport: ${JSON.stringify(ring)}`);
    if (variant === 'content') {
      const geometry = await list.locator('.pero-content-tab').last().evaluate(node => {
        const title = node.querySelector('.pero-content-tab-title'), label = node.querySelector('.pero-content-tab-label');
        const icon = node.querySelector('.pero-content-tab-leading svg'), close = node.querySelector('.pero-content-tab-close');
        return { font:parseFloat(getComputedStyle(title).fontSize), label:label.getBoundingClientRect().toJSON(),
          icon:icon.getBoundingClientRect().toJSON(), close:close.getBoundingClientRect().toJSON(), tab:node.getBoundingClientRect().toJSON() };
      });
      assert.ok(geometry.font < size, 'content titles have a quieter scale than page controls');
      assert.ok(geometry.close.width >= 24 && geometry.close.height >= 24, 'small close glyph retains a usable target');
      assert.ok(geometry.label.height < geometry.tab.height, 'title has vertical breathing room');
      assert.ok(geometry.icon.width <= geometry.label.height, 'leading glyph fits the title line');
      assert.ok(geometry.label.right <= geometry.close.left, 'long title leaves the close action visible');
    }
    await expect(page.getByRole('tabpanel').filter({hasText:`${variant}: Fourth document`})).toBeVisible();
  }
  const checkbox=page.getByRole('checkbox'); await checkbox.focus();
  assert.equal(await checkbox.evaluate(node=>parseFloat(getComputedStyle(node).outlineOffset)),2,'other controls retain their outside focus ring');
  if (process.env.PERO_TAB_SCREENSHOTS) {
    await mkdir(process.env.PERO_TAB_SCREENSHOTS,{recursive:true});
    await writeFile(resolve(process.env.PERO_TAB_SCREENSHOTS,`content-tabs-${size}.png`),await page.screenshot());
  }
});
