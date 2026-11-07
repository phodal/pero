// UI fixture only. Does not run a scheduler, Agent, backend or external request.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const directory = resolve(import.meta.dirname, '../dist');
const palettes = JSON.parse(await readFile(resolve(import.meta.dirname, '../../../web/src/theme.generated.json'), 'utf8'));
const records = [{ id: 'pulse-daily-brief', name: 'Pulse 每日简报', prompt: 'Summarize the supplied local material.', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0;BYSECOND=0', timezone: 'Local', enabled: true, target: { kind: 'local' }, next: null, scheduled: false, error: 'Re-save this schedule to freeze its IANA time zone', runs: [
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
      const record = { ...command.body, id: `fixture-${records.length + 1}`, enabled: !!command.body.enabled, scheduled: true, next: null, runs: [] };
      records.push(record); body = record;
    } else if (match) {
      const index = records.findIndex(record => record.id === decodeURIComponent(match[1]));
      if (index < 0) { status = 404; body = { error: 'Fixture record not found' }; }
      else if (command.method === 'DELETE') { records.splice(index, 1); status = 204; body = null; }
      else if (command.method === 'PUT') { Object.assign(records[index], command.body); body = records[index]; }
      else if (command.method === 'GET') body = records[index];
      else { const id = `request-${records[index].runs.length + 1}`; records[index].runs.push({key:{request_id:id,slot:'2026-10-31T09:00:00Z',trigger:'manual'},scheduled_for:'2026-10-31T09:00:00Z',state:'succeeded',session_id:'fixture-session'});body = {request_id:id}; }
    } else if (command.path === '/api/webhooks') body = { sources: [] };
    else if (command.path === '/api/projects') body = { items: [] };
    else { status = 503; body = { error: 'Not available in the UI fixture' }; }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status, body })); return;
  }
  if (url.pathname === '/test-shell') {
    response.writeHead(200, {'Content-Type':'text/html'}).end(`<html><body style="margin:0">
      <div style="height:36px;display:flex;align-items:center;gap:16px;font:14px system-ui;padding:0 12px">
        <span>Local UI fixture</span><label>Test theme <select id="theme"><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label>Test font size <select id="font"><option>14</option><option>18</option><option>24</option></select></label>
      </div><iframe title="Automations" sandbox="allow-scripts allow-same-origin" src="/" style="width:100%;height:calc(100vh - 36px);border:0"></iframe>
      <script>window.openedSessions=[];const palettes=${JSON.stringify(palettes)};
      function update(){const dark=document.getElementById('theme').value==='dark',ui=Number(document.getElementById('font').value);
        document.querySelector('iframe').contentWindow.postMessage({type:'pero:app:context',context:{locale:'en',dark,active:true,appearance:{dark,accent:'teal',typography:{ui,chat:14,code:14},palette:palettes[dark?'dark':'light']}}},'*')}
      document.getElementById('theme').onchange=update;document.getElementById('font').onchange=update;
      addEventListener('message',e=>{if(e.data?.type==='pero:app:open-session')openedSessions.push(e.data.sessionId);if(e.data?.type==='pero:app:ready')update()})</script></body></html>`);return;
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
