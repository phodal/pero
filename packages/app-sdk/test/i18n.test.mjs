import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppI18n, normalizeAppLocale, translateAppMessage } from '../src/i18n.mjs';
import { createUiRuntime } from './ui-test-runtime.mjs';
import { resolve } from 'node:path';
import themes from '../../../web/src/theme.generated.json' with {type:'json'};
import { createAppHost } from '../src/core.mjs';

const messages = {
  greeting: { zh: '你好，{name}', en: 'Hello, {name}' },
  fallback: { en: 'English fallback' },
};

test('App translations normalize host locales and interpolate data without mutating the dictionary', () => {
  const i18n = createAppI18n(messages);
  assert.equal(normalizeAppLocale('zh-Hans-CN'), 'zh');
  assert.equal(normalizeAppLocale('fr-FR'), 'en');
  assert.equal(i18n.t('zh-CN', 'greeting', { name: '小李' }), '你好，小李');
  assert.equal(i18n.t('en-US', 'greeting', { name: 'Ada' }), 'Hello, Ada');
  assert.equal(translateAppMessage(messages, 'zh', 'fallback'), 'English fallback');
  assert.equal(i18n.t('en', 'unknown'), 'unknown');
  assert.equal(messages.greeting.en, 'Hello, {name}');
});

test('App host exposes a normalized locale alongside its stable identity', () => {
  assert.equal(createAppHost({ name: 'demo', locale: 'zh-CN' }).info.locale, 'zh');
  assert.equal(createAppHost({ name: 'demo', locale: 'ja-JP' }).info.locale, 'en');
});


test('the App accepts host language changes with older or incompatible appearance data', async t => {
  const {React,dom,ui,render} = await createUiRuntime(t, {
    resolveDir:resolve(import.meta.dirname,'../src'), contents:"export {AppProvider} from './index';",
  });
  globalThis.location = dom.window.location;
  t.after(() => { delete globalThis.location; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({name:'connectors'}));
  await render(React.createElement(ui.AppProvider));
  const legacyPalette = Object.fromEntries(Object.entries(themes.dark).filter(([key]) => !key.startsWith('chart-')));
  const appearance = {dark:true, accent:'blue', typography:{ui:18,chat:14,code:14}, palette:legacyPalette};
  async function send(locale, appearance) {
    await React.act(async () => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      source:dom.window.parent, data:{type:'pero:app:context', context:{locale, dark:true, active:true, appearance}},
    })));
  }
  await send('zh-CN', appearance);
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(document.documentElement.style.getPropertyValue('--pero-font-ui'), '18px');
  assert.equal(document.documentElement.style.getPropertyValue('--pero-chart-1'), themes.dark['chart-1']);
  await send('en', {...appearance, palette:{...legacyPalette, action:'invalid'}});
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.documentElement.style.getPropertyValue('--pero-action'), themes.dark.action);
});
