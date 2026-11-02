/** App-owned messages, shared locale and formatting rules. No global registry. */
export function normalizeAppLocale(value) {
  return typeof value === 'string' && value.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function translateAppMessage(messages, locale, key, vars) {
  const entry = messages[key];
  let value = entry?.[normalizeAppLocale(locale)] ?? entry?.en ?? entry?.zh ?? key;
  if (vars) for (const [name, replacement] of Object.entries(vars)) value = value.split(`{${name}}`).join(String(replacement));
  return value;
}

export function createAppI18n(messages) {
  return Object.freeze({
    t: (locale, key, vars) => translateAppMessage(messages, locale, key, vars),
  });
}
