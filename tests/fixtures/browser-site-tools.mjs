import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const partnerSiteToolPath = '/partner-site-tools';

export function partnerSiteToolPage(parentOrigin) {
  return `<!doctype html><script>
    const parentOrigin = ${JSON.stringify(parentOrigin)};
    async function register() {
      await document.modelContext.registerTool({
        name: 'set_partner_marker',
        description: 'Change a marker in the partner fixture.',
        execute: ({text}) => {
          parent.postMessage({kind:'partner-effect', text}, parentOrigin);
          return {displayed:text};
        },
      }, { exposedTo: [parentOrigin] });
      await document.modelContext.registerTool({
        name: 'private_partner_tool',
        description: 'Only available in the partner origin.',
        execute: () => null,
      });
      parent.postMessage({kind:'partner-ready'}, parentOrigin);
    }
    register();
    </script>`;
}

export function siteToolPage(frame, foreignOrigin) {
  const name = frame ? 'set_frame_heading' : 'set_fixture_heading';
  return `<!doctype html><title>Site tools fixture</title><h1>Waiting for a site tool</h1>
<script>
if (${!frame}) {
  addEventListener('message', event => {
    if (event.origin !== ${JSON.stringify(foreignOrigin)}) return;
    if (event.data?.kind === 'partner-ready') document.body.dataset.partnerReady = 'yes';
    if (event.data?.kind === 'partner-effect') document.body.dataset.partnerEffect = event.data.text;
  });
}
document.modelContext.registerTool({
  name: ${JSON.stringify(name)},
  description: 'Set the fixture heading to the supplied text.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  execute: ({text}) => {
    document.querySelector('h1').textContent = text;
    return { displayed: text };
  },
}).then(() => document.body.dataset.ready = 'yes');
</script>
${frame ? '' : `<iframe title="Site tools frame" src="/webmcp-frame"></iframe>
<iframe title="Partner tools frame" src="${foreignOrigin + partnerSiteToolPath}" allow="tools"></iframe>`}`;
}

export async function checkSiteTools({ app, origin, foreignOrigin, menu, prompt, open, confirm, document, receiptDir }) {
  const siteToolTab = origin + '/webmcp';
  await open(siteToolTab);
  const readSiteToolPage = expression => app.evaluate(({ webContents }, { url, expression }) => webContents
    .getAllWebContents().find(view => view.getURL() === url).executeJavaScript(expression), { url: siteToolTab, expression });
  await expect.poll(() => readSiteToolPage(`document.body.dataset.ready + ':' +
    document.querySelector('iframe').contentDocument?.body?.dataset?.ready`)).toBe('yes:yes');
  await confirm(1);
  await expect.poll(async () => (await document(siteToolTab))?.observation.notice).toBe('Browser Use allowed');
  const listTools = { action: 'listSiteTools', tabId: siteToolTab };
  const [siteToolsOff] = await prompt([listTools]);
  expect(siteToolsOff).toMatchObject({ isError: true, error: expect.stringContaining('Enable Browser Site Tools') });
  await menu('browser-use-site-tools', true);
  const [listed] = await prompt([listTools]);
  expect(listed).toMatchObject({ kind: 'siteTools', origin: origin, tools: expect.arrayContaining([
    expect.objectContaining({ name: 'set_fixture_heading', description: 'Set the fixture heading to the supplied text.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }),
    expect.objectContaining({ name: 'set_frame_heading', frameUrl: origin + '/webmcp-frame' }),
  ]) });
  expect(listed.tools.map(tool => tool.origin)).toEqual([origin, origin]);
  const operateSiteTool = { action: 'callSiteTool', tabId: siteToolTab, toolId: listed.tools.find(tool => tool.name === 'set_fixture_heading').id,
    input: { text: 'Changed by actual WebMCP' } };
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (_window, options) => {
      globalThis.siteToolPrompt = options;
      return { response: globalThis.siteToolApproved ? 1 : 0, checkboxChecked: false };
    };
  });
  const [siteToolDeclined] = await prompt([operateSiteTool]);
  expect(siteToolDeclined).toMatchObject({ isError: true, error: expect.stringContaining('site tool call was declined') });
  expect(await readSiteToolPage("document.querySelector('h1').textContent")).toBe('Waiting for a site tool');
  await app.evaluate(() => { globalThis.siteToolApproved = true; });
  const [siteToolRun] = await prompt([operateSiteTool]);
  expect(siteToolRun).toMatchObject({ kind: 'siteToolResult', outcome: 'dispatched', result: { displayed: 'Changed by actual WebMCP' } });
  expect(await readSiteToolPage("document.querySelector('h1').textContent")).toBe('Changed by actual WebMCP');
  const toolPrompt = await app.evaluate(() => globalThis.siteToolPrompt);
  expect(toolPrompt.message).toBe('Run this website tool?');
  expect(toolPrompt.detail).toContain(origin + '\n\nset_fixture_heading');
  expect(toolPrompt.detail).toContain('"text": "Changed by actual WebMCP"');
  const frameInput = { ...operateSiteTool, toolId: listed.tools.find(tool => tool.name === 'set_frame_heading').id,
    input: { text: 'Changed in the frame' } };
  const [frameRun] = await prompt([frameInput]);
  expect(frameRun).toMatchObject({ kind: 'siteToolResult', outcome: 'dispatched', result: { displayed: 'Changed in the frame' } });
  expect(await readSiteToolPage("document.querySelector('iframe').contentDocument.querySelector('h1').textContent"))
    .toBe('Changed in the frame');
  expect((await app.evaluate(() => globalThis.siteToolPrompt)).detail).toContain(origin + '/webmcp-frame');
  const receipt = JSON.parse(await readFile(resolve(receiptDir, siteToolRun.receiptId + '.result.json'), 'utf8'));
  expect(receipt).toEqual({ id: siteToolRun.receiptId, outcome: 'dispatched' });
  const [toolReload, oldTool, newTools] = await prompt([
    { action: 'reload', tabId: siteToolTab }, operateSiteTool, listTools,
  ]);
  expect(toolReload.outcome).toBe('dispatched');
  expect(oldTool).toMatchObject({ isError: true, error: expect.stringContaining('List the page tools again') });
  expect(newTools.tools.find(tool => tool.name === 'set_fixture_heading').id).not.toBe(operateSiteTool.toolId);
  await expect.poll(() => readSiteToolPage('document.body.dataset.partnerReady')).toBe('yes');
  const fromPartner = { ...listTools, fromOrigins: [foreignOrigin] };
  await app.evaluate(() => { globalThis.siteToolApproved = false; });
  const [discoveryDeclined] = await prompt([fromPartner]);
  expect(discoveryDeclined).toMatchObject({ isError: true, error: expect.stringContaining('Discovery of cross-origin site tools was declined') });
  const discoveryPrompt = await app.evaluate(() => globalThis.siteToolPrompt);
  expect(discoveryPrompt.message).toBe('Allow discovery of partner site tools?');
  expect(discoveryPrompt.detail).toContain(origin);
  expect(discoveryPrompt.detail).toContain(foreignOrigin);
  await app.evaluate(() => { globalThis.siteToolApproved = true; });
  const [partnerTools] = await prompt([fromPartner]);
  const offered = partnerTools.tools.filter(tool => tool.origin === foreignOrigin);
  expect(offered.map(tool => tool.name)).toEqual(['set_partner_marker']);
  const [partnerRun] = await prompt([{ ...operateSiteTool, toolId: offered[0].id, input: { text: 'Trusted partner effect' } }]);
  expect(partnerRun).toMatchObject({ kind: 'siteToolResult', outcome: 'dispatched', result: { displayed: 'Trusted partner effect' } });
  await expect.poll(() => readSiteToolPage('document.body.dataset.partnerEffect')).toBe('Trusted partner effect');
  expect((await app.evaluate(() => globalThis.siteToolPrompt)).detail).toContain(foreignOrigin + '\n\nset_partner_marker');
  await menu('browser-use-site-tools', false);
  await prompt([{ action: 'closeTab', tabId: siteToolTab }, { action: 'activate', tabId: origin + '/' }]);
  return { defaultOff: true, separateConsent: true, sameOriginFrame: true, invalidatedAfterReload: true,
    crossOriginDiscoveryConsent: true, privatePartnerToolExcluded: true, crossOriginEffect: true, receipt };
}
