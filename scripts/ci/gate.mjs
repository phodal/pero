import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciScopeGlobs } from './workflow-scope.mjs';
export function failures(jobs, full, paperHtmlLive = false, scopes = {}) {
  const dailyOnly = new Set(['desktop-linux', 'desktop', 'desktop-acceptance', 'windows-acl-sandbox']);
  return Object.entries(jobs).filter(([name, job]) =>
    job.result !== 'success' && !(job.result === 'skipped' && ((!full && (dailyOnly.has(name) || (name in ciScopeGlobs && scopes[name] === false))) || (name === 'paper-html-live' && !paperHtmlLive)))).map(([name]) => name);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const jobs = JSON.parse(process.env.RESULTS);
  const full = process.env.FULL_MATRIX === 'true';
  for (const [name, job] of Object.entries(jobs)) console.log(name, job.result);
  const failed = failures(jobs, full, process.env.PAPER_HTML_LIVE === 'true', JSON.parse(process.env.SCOPES || '{}'));
  if (failed.length) { console.error(`Required checks did not pass: ${failed.join(', ')}`); process.exitCode = 1; }
}
