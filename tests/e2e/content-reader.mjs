// Actual GPUI/Wasm reading and performance in a background Electron window.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir, cpus, platform, arch, release } from 'node:os';
import { createHash } from 'node:crypto';
const root = resolve(
  process.env.PERO_CONTENT_TEST_ROOT || resolve(import.meta.dirname, '../..'),
);
const out = resolve(import.meta.dirname, '../../test-results/content-reader');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-content-e2e-'));
await mkdir(out, { recursive: true });
const source =
  '[\n' +
  Array.from(
    { length: 8000 },
    (_, i) =>
      `{"id":${9007199254740993n + BigInt(i)},"label":"中文 row ${i}","amount":1.0000000000000000001,"data":{"ok":true,"text":"${'x'.repeat(25)}"}}`,
  ).join(',\n') +
  '\n]';
const content = resolve(temp, 'source.json');
await writeFile(content, source);
const agents = resolve(temp, 'agents.json');
await writeFile(
  resolve(temp, 'settings.json'),
  JSON.stringify({ chat_agent: 'fixture' }),
);
await writeFile(
  agents,
  JSON.stringify([
    {
      id: 'fixture',
      name: 'Content fixture',
      command: process.execPath,
      args: [
        resolve(root, 'tests/fixtures/acp-agent.mjs'),
        `--content-file=${content}`,
      ],
    },
  ]),
);
const env = {
  ...process.env,
  PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'),
  PERO_LOCALE: 'en',
  PERO_APPS_ROOT: resolve(temp, 'apps'),
  PERO_SETTINGS_PATH: resolve(temp, 'settings.json'),
  PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'),
  PERO_AGENTS_FILE: agents,
};
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
const app = await electron.launch({
  args: ['--use-mock-keychain', resolve(root, 'desktop')],
  cwd: root,
  env,
});
let page;
try {
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(
    () =>
      window.peroDiagnostics &&
      JSON.parse(window.peroDiagnostics.snapshot()).connected &&
      !document.getElementById('loading'),
    undefined,
    { timeout: 60000 },
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1488, 1086),
  );
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return (
      c?.width === Math.round(innerWidth * devicePixelRatio) &&
      c.height === Math.round(innerHeight * devicePixelRatio)
    );
  });
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const state = () =>
    page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  await expect
    .poll(async () => (await state()).agents?.some((a) => a.id === 'fixture'))
    .toBe(true);
  await page.mouse.click(100, 28);
  await expect.poll(async () => (await state()).chats.length).toBe(1);
  const thread = (await state()).chats[0].id;
  const id = createHash('sha256').update(source).digest('hex');
  const artifactDirectory = resolve(
    temp,
    'desktop/app-use-evidence/content',
    createHash('sha256').update(thread).digest('hex'),
  );
  await writeFile(
    content,
    JSON.stringify({
      type: 'content_reference',
      artifact: {
        id,
        sha256: id,
        bytes: Buffer.byteLength(source),
        mediaType: 'application/json',
      },
      preview: source.slice(0, 100),
    }),
  );
  await expect.poll(async () => (await state()).chats[0].agent).toBe('fixture');
  await expect.poll(async () => (await state()).composerFocused).toBe(true);
  await page.keyboard.type('contentview');
  await expect.poll(async () => (await state()).composer).toBe('contentview');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await state()).chats[0].tools?.length, {
      timeout: 15000,
    })
    .toBe(1);
  await expect.poll(async () => (await state()).chats[0].state).toBe('idle');
  await page.screenshot({ scale: 'css', path: resolve(out, 'collapsed.png') });
  await page.evaluate(() => {
    window.__contentLongTasks = [];
    new PerformanceObserver((list) =>
      window.__contentLongTasks.push(
        ...list
          .getEntries()
          .map((e) => ({ start: e.startTime, duration: e.duration })),
      ),
    ).observe({ type: 'longtask', buffered: false });
  });
  const paint = () =>
    page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
  const measure = async (x, y) => {
    const start = await page.evaluate(() => performance.now());
    await page.mouse.click(x, y);
    await paint();
    const end = await page.evaluate(() => performance.now());
    return { start, end, ms: end - start };
  };
  const clickBounds = async (bounds, dx = 20, dy = 12) => {
    expect(bounds?.width).toBeGreaterThan(0);
    return measure(bounds.x + dx, bounds.y + dy);
  };
  const toolBounds = async () => (await state()).toolBounds[0];
  await clickBounds((await toolBounds()).bounds);
  await expect.poll(async () => (await state()).contentReaders.length).toBe(1);
  // A missing artifact gives a visible error and a retry; no Agent turn is sent.
  await clickBounds((await toolBounds()).artifact);
  await expect
    .poll(async () => (await state()).chats[0].tools[0].artifact.status.state)
    .toBe('failed');
  await page.screenshot({
    scale: 'css',
    path: resolve(out, 'missing-artifact.png'),
  });
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(resolve(artifactDirectory, id + '.json'), source);
  const samples = { preview: [], source: [], retainedSwitch: [] };
  samples.preview.push(await clickBounds((await toolBounds()).artifact));
  await expect
    .poll(async () => (await state()).contentReaders[0]?.rows, {
      timeout: 15000,
    })
    .toBe(8000);
  expect((await state()).chats[0].tools[0].content.length).toBeLessThan(2048);
  expect(
    (await state()).chats[0].messages.filter((m) => m.role === 'user').length,
  ).toBe(1);
  await page.screenshot({ scale: 'css', path: resolve(out, 'preview.png') });
  const reader = async () => (await state()).contentReaders[0];
  const mode = async (source) =>
    clickBounds((await reader()).bounds, source ? 100 : 30, 15);
  samples.source.push(await mode(true));
  await expect.poll(async () => (await reader()).source).toBe(true);
  await expect
    .poll(async () => (await reader()).editorBytes)
    .toBe(Buffer.byteLength(source));
  await page.screenshot({ scale: 'css', path: resolve(out, 'source.png') });
  for (
    let cycle = 0;
    cycle < (process.argv.includes('--benchmark') ? 30 : 1);
    cycle++
  ) {
    await mode(false);
    samples.retainedSwitch.push(await mode(true));
    await clickBounds((await toolBounds()).bounds);
    expect((await reader()).source).toBe(true);
    await clickBounds((await toolBounds()).bounds);
    expect((await reader()).source).toBe(true);
  }
  const memory = await app.evaluate(
    ({ app, BrowserWindow }) =>
      app
        .getAppMetrics()
        .find(
          (p) =>
            p.pid ===
            BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(),
        )?.memory,
  );
  const phases = [];
  const phase = async (name) =>
    phases.push({ name, time: await page.evaluate(() => performance.now()) });
  // Native partial selection and copying must preserve the source spelling too.
  const partialBounds = (await reader()).bounds;
  await page.mouse.click(partialBounds.x + 200, partialBounds.y + 90);
  await paint();
  const partialLine = (await reader()).cursor.line;
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press(
    `${process.platform === 'darwin' ? 'Meta' : 'Control'}+c`,
  );
  await expect
    .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(source.split('\n')[partialLine]);
  await phase('select-and-readonly-type');
  const bounds = (await reader()).bounds;
  await page.mouse.click(bounds.x + 350, bounds.y + 90);
  await paint();
  await phase('select-all');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+a`);
  await paint();
  const selected = (await state()).contentReaders[0];
  expect(selected.selection.start).toBe(0);
  expect(selected.selection.end).toBe(Buffer.byteLength(source));
  await page.screenshot({
    scale: 'css',
    path: resolve(out, 'selected-source.png'),
  });
  await phase('readonly-typing');
  await page.keyboard.type('must not change readonly data');
  await paint();
  expect((await state()).contentReaders[0].editorBytes).toBe(
    Buffer.byteLength(source),
  );
  await phase('copy');
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press(`${modifier}+c`);
  await expect
    .poll(
      async () =>
        (await app.evaluate(({ clipboard }) => clipboard.readText())) ===
        source,
    )
    .toBe(true);
  await phase('find');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(`${modifier}+f`);
  await expect.poll(async () => (await reader()).search?.open).toBe(true);
  await page.waitForFunction(
    () =>
      document.activeElement?.tagName === 'TEXTAREA' &&
      document.activeElement.value === '',
  );
  await page.keyboard.type('9007199254748992', { delay: 20 });
  await page.keyboard.press('Enter');
  await paint();
  await expect
    .poll(async () => (await reader()).search?.query)
    .toBe('9007199254748992');
  await expect.poll(async () => (await reader()).search?.matches).toBe(1);
  const beforeCollapse = await reader();
  await clickBounds((await toolBounds()).bounds);
  await clickBounds((await toolBounds()).bounds);
  expect((await reader()).search).toEqual(beforeCollapse.search);
  expect((await reader()).selection).toEqual(beforeCollapse.selection);
  await page.screenshot({ scale: 'css', path: resolve(out, 'find.png') });

  await clickBounds((await reader()).bounds, 140, 15);
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.type('ROW', { delay: 20 });
  await expect.poll(async () => (await reader()).search.matches).toBe(8000);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await paint();
  await expect.poll(async () => (await reader()).search.matches).toBe(0);
  expect((await reader()).search.query).toBe('ROW');
  await page.keyboard.press('Space');
  await paint();
  await expect.poll(async () => (await reader()).search.matches).toBe(8000);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await paint();
  const afterPrevious = (await reader()).search.current;
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await paint();
  expect((await reader()).search.current).not.toEqual(afterPrevious);
  await phase('scroll');
  await page.keyboard.press('Escape');
  await mode(false);
  // RAF cadence during actual wheel-driven table scrolling, outside snapshot polling.
  await page.evaluate(() => {
    window.__contentFrames = [];
    window.__contentFrameDone = false;
    let last;
    let count = 0;
    const tick = (t) => {
      if (last !== undefined) window.__contentFrames.push(t - last);
      last = t;
      if (++count < 90) requestAnimationFrame(tick);
      else window.__contentFrameDone = true;
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(800, 400);
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 180);
    await paint();
  }
  await page.waitForFunction(() => window.__contentFrameDone);
  await page.screenshot({ scale: 'css', path: resolve(out, 'scrolled.png') });
  // Filter and sort the source-backed table, then use actual cell keyboard copy.
  const filterRows=async query=>{
    const bounds=(await reader()).table.bounds;
    await page.mouse.click(bounds.x+100,bounds.y+15);
    await page.keyboard.press(`${modifier}+a`);if(query)await page.keyboard.insertText(query);else await page.keyboard.press('Backspace');await paint();
  };
  const grid=async()=>(await reader()).table.gridBounds;
  await phase('table-filter');await filterRows('中文 row 100');
  await expect.poll(async()=>(await reader()).table.visibleRows).toBe(11);
  expect((await reader()).table.firstRows[0]).toBe(101);
  let tableBounds=await grid();await page.mouse.click(tableBounds.x+100,tableBounds.y+42);
  await expect.poll(async()=>(await reader()).table.selectedCell).toEqual([0,1]);
  await page.keyboard.press(`${modifier}+c`);
  await expect.poll(async()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe(String(9007199254740993n+100n));
  await page.keyboard.press('ArrowRight');await page.keyboard.press(`${modifier}+c`);
  await expect.poll(async()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('"中文 row 100"');
  await phase('table-sort');await page.mouse.click(tableBounds.x+214,tableBounds.y+14);
  await expect.poll(async()=>(await reader()).table.firstRows[0]).toBe(1010);
  expect((await reader()).table.selectedCell).toBe(null);
  tableBounds=await grid();await page.mouse.click(tableBounds.x+100,tableBounds.y+42);await page.keyboard.press('Enter');
  await expect.poll(async()=>(await reader()).source).toBe(true);
  expect((await reader()).cursor.line).toBe(1010);
  await mode(false);expect((await reader()).table.firstRows[0]).toBe(1010);
  await filterRows('no matching value');await expect.poll(async()=>(await reader()).table.visibleRows).toBe(0);
  await page.screenshot({scale:'css',path:resolve(out,'filtered-empty.png')});
  await filterRows('');await expect.poll(async()=>(await reader()).table.visibleRows).toBe(8000);
  expect((await reader()).table.firstRows[0]).toBe(8000);
  tableBounds=await grid();await page.mouse.click(tableBounds.x+214,tableBounds.y+14);
  await expect.poll(async()=>(await reader()).table.sort).toEqual([0,'ascending']);
  await page.mouse.click(tableBounds.x+214,tableBounds.y+14);
  await expect.poll(async()=>(await reader()).table.sort).toBe(null);
  await phase('table-resize');
  await page.mouse.move(tableBounds.x+228,tableBounds.y+14);await page.mouse.down();
  await page.mouse.move(tableBounds.x+288,tableBounds.y+14,{steps:6});await page.mouse.up();await paint();
  await expect.poll(async()=>(await reader()).table.widths[1]).toBeGreaterThan(220);
  const resized=(await reader()).table.widths[1];await mode(true);await mode(false);
  expect((await reader()).table.widths[1]).toBe(resized);
  await page.screenshot({scale:'css',path:resolve(out,'table-selection.png')});
  // Open a nested object, return to the record view, then locate a scalar.
  tableBounds=await grid();
  const widths=(await reader()).table.widths;
  await page.mouse.dblclick(tableBounds.x+widths.slice(0,4).reduce((a,b)=>a+b,0)+40,tableBounds.y+42);
  await expect.poll(async () => (await reader()).rows).toBe(2);
  await page.screenshot({ scale: 'css', path: resolve(out, 'nested.png') });
  await clickBounds((await reader()).bounds, 150, 15);
  await expect.poll(async () => (await reader()).rows).toBe(8000);
  tableBounds=await grid();await page.mouse.dblclick(tableBounds.x+100,tableBounds.y+42);
  await expect.poll(async () => (await reader()).source).toBe(true);
  expect((await reader()).cursor.line).toBeGreaterThan(0);
  await setAppearance(page, 'dark');
  await mode(false);
  await paint();
  await page.screenshot({ scale: 'css', path: resolve(out, 'dark.png') });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 800),
  );
  await paint();
  await page.screenshot({ scale: 'css', path: resolve(out, 'narrow.png') });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1488, 1086),
  );
  await paint();

  for (let i = 0; i < 13; i++) {
    await page.mouse.click(100, 28);
    await paint();
    await expect.poll(async () => (await state()).composerFocused).toBe(true);
    await page.keyboard.type(`tab ${i}`);
    await page.keyboard.press('Enter');
    await expect
      .poll(
        async () => {
          const s = await state();
          return s.chats[s.activeChat]?.state;
        },
        { timeout: 15000 },
      )
      .toBe('idle');
  }

  expect((await state()).contentTabs.length).toBe(14);
  const tabVisible = async () => {
    const b = (await state()).activeTabBounds;
    return !!b && b.left >= b.stripLeft - 1 && b.right <= b.stripRight + 1;
  };
  await expect.poll(tabVisible).toBe(true);

  const lastTab = (await state()).activeContent;
  await page.screenshot({
    scale: 'css',
    path: resolve(out, 'fourteen-tabs.png'),
  });
  await page.keyboard.press('Control+Shift+Tab');
  await paint();
  expect((await state()).activeContent).not.toEqual(lastTab);
  await page.keyboard.press('Control+Tab');
  await paint();
  expect((await state()).activeContent).toEqual(lastTab);
  // Close the preceding visible tab using the current tab's observed edge.
  await page.mouse.click((await state()).activeTabBounds.left - 17, 18);
  await paint();
  expect((await state()).contentTabs.length).toBe(13);
  expect((await state()).activeContent).toEqual(lastTab);
  await page.screenshot({
    scale: 'css',
    path: resolve(out, 'close-earlier-tab.png'),
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 800),
  );
  await paint();
  expect((await state()).activeContent).toEqual(lastTab);
  await expect.poll(tabVisible).toBe(true);
  await page.screenshot({
    scale: 'css',
    path: resolve(out, 'narrow-tabs.png'),
  });

  const percentile = (values, p) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  const summary = Object.fromEntries(
    Object.entries(samples).map(([key, values]) => [
      key,
      {
        count: values.length,
        medianMs: percentile(
          values.map((v) => v.ms),
          0.5,
        ),
        p95Ms: percentile(
          values.map((v) => v.ms),
          0.95,
        ),
        maxMs: Math.max(...values.map((v) => v.ms)),
      },
    ]),
  );
  const longTasks = await page.evaluate(() => window.__contentLongTasks);
  const measuredTasks = longTasks.filter((task) =>
    Object.values(samples)
      .flat()
      .some((s) => task.start < s.end && task.start + task.duration > s.start),
  );
  const frames = await page.evaluate(() => window.__contentFrames);
  const wasmFile = (await readdir(resolve(root, 'web/dist/assets'))).find(
    (name) => name.startsWith('pero_ui_bg-') && name.endsWith('.wasm'),
  );
  const wasmBytes = await readFile(resolve(root, 'web/dist/assets', wasmFile));
  if (process.env.PERO_CONTENT_BUILD_KIND === 'release-Oz')
    expect(wasmBytes.length).toBeLessThan(50 * 1024 * 1024);
  const receipt = {
    build: {
      kind: process.env.PERO_CONTENT_BUILD_KIND || 'unspecified',
      wasmBytes: wasmBytes.length,
      sha256: createHash('sha256').update(wasmBytes).digest('hex'),
    },
    dataset: {
      bytes: Buffer.byteLength(source),
      rows: 8000,
      sha256: createHash('sha256').update(source).digest('hex'),
    },
    environment: {
      platform: platform(),
      arch: arch(),
      os: release(),
      cpu: cpus()[0].model,
      node: process.version,
      electron: await app.evaluate(() => process.versions.electron),
    },
    summary,
    frames: {
      count: frames.length,
      p95Ms: percentile(frames, 0.95),
      maxMs: Math.max(...frames),
    },
    memory,
    phases,
    measuredLongTasks: measuredTasks,
    allLongTasks: longTasks,
    errors,
  };
  await writeFile(
    resolve(out, 'performance.json'),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      summary: receipt.summary,
      frames: receipt.frames,
      measuredLongTasks: measuredTasks,
      errors,
    }),
  );
  expect(errors).toEqual([]);
  // Performance is recorded; functional equivalence is this probe's acceptance gate.
} catch (error) {
  if (page) {
    await page.screenshot({ scale: 'css', path: resolve(out, 'failure.png') });
    await writeFile(
      resolve(out, 'failure.json'),
      await page.evaluate(() => window.peroDiagnostics.snapshot()),
    );
  }
  throw error;
} finally {
  if (page && errors.length) console.error(errors);
  await app.close();
}
