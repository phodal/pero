// UI fixture only. Does not run a scheduler, Agent, backend or external request.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const directory = resolve(import.meta.dirname, '../dist');
const records = [{ id: 'pulse-daily-brief', name: 'Pulse 每日简报', prompt: 'Summarize the supplied local material.', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0;BYSECOND=0', timezone: 'Local', enabled: true, target: { kind: 'local' }, next: '2026-11-02T09:00:00+08:00', scheduled: true, runs: [
  { key: { automation: 'pulse-daily-brief', slot: '2026-10-31T08:35:00+08:00', trigger: 'manual' }, scheduled_for: '2026-10-31T08:35:00+08:00', settled_at: '2026-10-31T08:35:00+08:00', state: 'succeeded', session_id: 'fixture-session' },
  { key: { automation: 'pulse-daily-brief', slot: '2026-10-31T08:33:00+08:00', trigger: 'schedule' }, scheduled_for: '2026-10-31T08:33:00+08:00', state: 'skipped', skip_reason: 'missed' },
]}];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'POST' && url.pathname === '/host/automation') {
    let text = ''; for await (const chunk of request) text += chunk;
    const command = JSON.parse(text);
    let status = 200, body = {};
    const match = command.path.match(/^\/api\/automations\/([^/]+)(\/run)?$/);
    if (command.path === '/api/automations' && command.method === 'GET') body = { items: records };
    else if (command.path === '/api/automations' && command.method === 'POST') {
      const record = { ...command.body, id: `fixture-${records.length + 1}`, enabled: true, scheduled: true, next: '2026-11-02T09:00:00+08:00', runs: [] };
      records.push(record); body = record;
    } else if (match) {
      const index = records.findIndex(record => record.id === decodeURIComponent(match[1]));
      if (index < 0) { status = 404; body = { error: 'Fixture record not found' }; }
      else if (command.method === 'DELETE') { records.splice(index, 1); status = 204; body = null; }
      else if (command.method === 'PUT') { Object.assign(records[index], command.body); body = records[index]; }
      else if (command.method === 'GET') body = records[index];
      else body = { accepted: true };
    } else if (command.path === '/api/webhooks') body = { sources: [] };
    else if (command.path === '/api/projects') body = { items: [] };
    else { status = 503; body = { error: 'Not available in the UI fixture' }; }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status, body })); return;
  }
  if (request.method === 'POST' && url.pathname === '/host/connectors') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, connections: [], providers: [] })); return;
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!['index.html', 'index.js', 'index.css'].includes(file)) { response.writeHead(404).end(); return; }
  let value = await readFile(resolve(directory, file));
  if (file === 'index.html') {
    const context = { locale: url.searchParams.get('locale') || 'zh-CN', dark: url.searchParams.get('theme') === 'dark', active: true };
    value = Buffer.from(value.toString().replace('<script type="module"', `<script>addEventListener('message',event=>{if(event.data?.type==='pero:app:ready')postMessage({type:'pero:app:context',context:${JSON.stringify(context)}},'*')})</script><script type="module"`));
  }
  response.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'text/css' }).end(value);
});
server.listen(0, '127.0.0.1', () => console.log(`UI fixture: http://127.0.0.1:${server.address().port}/?locale=zh-CN`));
