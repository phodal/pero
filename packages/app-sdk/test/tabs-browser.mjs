// Exercise clipped scroll strips in a real renderer; jsdom has no outline geometry.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';

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
              ? <ContentTab key={id} value={id} label={id} closeLabel="Close"/>
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
    await expect(page.getByRole('tabpanel').filter({hasText:`${variant}: Fourth document`})).toBeVisible();
  }
  const checkbox=page.getByRole('checkbox'); await checkbox.focus();
  assert.equal(await checkbox.evaluate(node=>parseFloat(getComputedStyle(node).outlineOffset)),2,'other controls retain their outside focus ring');
});
