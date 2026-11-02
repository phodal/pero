import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppI18n, normalizeAppLocale, translateAppMessage } from '../src/i18n.mjs';
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

