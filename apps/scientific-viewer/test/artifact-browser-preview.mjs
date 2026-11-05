// Production Viewer with a bounded fixture shell. No model, Python backend or Native profile.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { examples } from '../ui-src/examples.ts';

const root = resolve(import.meta.dirname, '../../..'), dist = resolve(root, 'apps/scientific-viewer/dist');
const thread = 'finder-browser-fixture';
const report = value => `# 产物区验证报告\n\n这是界面验收使用的合成记录。\n\n| 项目 | 数值 |\n| --- | --- |\n| 示例结果 | ${value} |\n\n未执行科学实验，没有调用真实模型。`;
const files = [
  { id: 'report', title: '验证报告', filename: 'report.md', media: { kind: 'document', format: { kind: 'markdown' } }, mime: 'text/markdown', texts: [report(7), report(9)] },
  { id: 'saved', title: '验证报告已保存', filename: 'saved-report.md', media: { kind: 'document', format: { kind: 'markdown' } }, mime: 'text/markdown', texts: ['# 验证报告已保存\n\n第 2 版报告已交付到本会话产物区。旧版本保持不变。\n\n未执行科学实验，没有调用真实模型。'] },
  { id: 'copy', title: 'report.md', filename: 'report.md', media: { kind: 'document', format: { kind: 'markdown' } }, mime: 'text/markdown', texts: [report(9)] },
  { id: 'logo', title: 'Pero 标志', filename: 'logo.svg', media: { kind: 'image', mime_type: 'image/svg+xml' }, mime: 'image/svg+xml', texts: [await readFile(resolve(root, 'resources/logo.svg'), 'utf8')] },
  { id: 'code', title: '分析代码', filename: 'analysis.py', media: { kind: 'document', format: { kind: 'code', language: 'python' } }, mime: 'text/x-python', texts: ['from statistics import mean\n\nvalues = [20, 21, 23, 22]\nprint(mean(values))\n'] },
  { id: 'csv', title: '合成数据表', filename: 'results.csv', media: { kind: 'csv' }, mime: 'text/csv', texts: ['time[s],voltage[V]\n0,4.2\n1,\n2,3.9\n'] },
  { id: 'pdf', title: '合成 PDF 证据', filename: 'evidence.pdf', media: { kind: 'pdf' }, mime: 'application/pdf', texts: [examples.find(item => item.name === 'sample.pdf').text] },
  { id: 'notebook', title: '已保存的分析', filename: 'analysis.ipynb', media: { kind: 'notebook' }, mime: 'application/x-ipynb+json', texts: [examples.find(item => item.name === 'demo.ipynb').text] },
];
const artifacts = files.map(file => ({ id: file.id, thread_id: thread, title: file.title, versions: file.texts.map((text, index) => ({
  version: index + 1, sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text),
  format: file.media.kind === 'document' ? file.media.format : { kind: 'text' }, media: file.media, filename: file.filename,
  source: { kind: 'text' }, created_at: 1790000000,
})) }));
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Artifact Browser production preview</title>
<style>*{box-sizing:border-box}html,body{height:100%;margin:0;font:14px/1.5 system-ui;background:#f7f9fc;color:#172536}body{display:flex}aside{flex:1;padding:24px}h1{font-size:18px;margin:0 0 16px}p{margin:0 0 12px;color:#596b7d}textarea{width:100%;height:180px;resize:vertical;font:14px/1.6 system-ui;background:white;color:inherit;border:1px solid #748599;border-radius:4px;padding:12px}.fixture-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{font:12px system-ui;cursor:pointer;color:inherit;height:24px;border:0;border-radius:4px;padding:0 8px;background:transparent}button:hover{background:#eef3f8}button:focus-visible{outline:2px solid #007f86;outline-offset:2px}.pane{width:440px;max-width:100%;height:100%;border-left:.5px solid #dce4ed;background:white;display:flex;flex-direction:column}.header{height:36px;flex:none;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:.5px solid #dce4ed}.header strong{font-size:14px}.modes{display:flex;background:#eef3f8;padding:2px;border-radius:6px;margin-left:auto;gap:2px}.modes button{width:28px;height:22px;padding:3px}.modes button[aria-pressed=true]{background:white;box-shadow:0 0 0 .5px #dce4ed}.modes svg{width:15px;height:15px;display:block}iframe{width:100%;border:0;flex:1;min-height:0}.footer{display:flex;align-items:center;gap:8px;border-top:.5px solid #dce4ed;padding:0 12px;height:36px;flex:none;font-size:12px;color:#596b7d}.footer .grow{flex:1}.footer button{background:#007f86;color:white}body.dark{background:#0b1420;color:#eaf1f8}body.dark .pane,body.dark textarea{background:#121f2e}body.dark .header,body.dark .footer,body.dark .pane{border-color:#34485d}body.dark .modes{background:#192a3b}body.dark .modes button[aria-pressed=true]{background:#121f2e;box-shadow:0 0 0 .5px #34485d}body.dark p,body.dark .footer{color:#acbbcb}body.dark button:hover{background:#192a3b}@media(max-width:760px){aside{display:none}.pane{width:100%;border:0}}</style>
<aside><h1>Production Artifact Browser</h1><p>合成记录，仅替代 Host 传输。此页面不运行模型或 Python。</p><p>单击选择；双击或空格预览；Esc 返回浏览。</p><label for="draft">原会话提问草稿</label><textarea id="draft" readonly></textarea><div class="fixture-controls"><button id="theme">切换深色</button><button id="all">全部类型</button><button id="empty">空目录</button><button id="invalid">无效上下文</button><button id="refresh">恢复目录</button><button id="reject">拒绝下次引用</button></div></aside>
<section class="pane"><header class="header"><strong>产物 <span id="count">3</span></strong><div class="modes" role="group" aria-label="产物视图"><button data-view="icons" aria-label="图标视图" aria-pressed="true"><img width="15" height="15" src="/fixture-icons/layout-grid.svg"></button><button data-view="list" aria-label="列表视图" aria-pressed="false"><img width="15" height="15" src="/fixture-icons/layout-list.svg"></button><button data-view="gallery" aria-label="画廊视图" aria-pressed="false"><img width="15" height="15" src="/fixture-icons/gallery-horizontal.svg"></button></div></header><iframe title="产物浏览器" src="/artifact.html?thread_id=${thread}"></iframe><footer class="footer"><span id="selection">验证报告 v2</span><span class="grow"></span><button id="whole">加入提问</button></footer></section>
<script>
const artifacts=${JSON.stringify(artifacts)},frame=document.querySelector('iframe'),thread=${JSON.stringify(thread)};
let dark=false,all=false,empty=false,invalid=false,reject=false;
let state={thread_id:thread,artifacts:artifacts.slice(0,3),selected:{thread_id:thread,artifact_id:'report',version:2},view:localStorage.getItem('artifact-browser-fixture-view')||'icons'};
function publish(){state.artifacts=empty?[]:artifacts.slice(0,all?undefined:3);if(empty)state.selected=null;const data=invalid?{...state,selected:{thread_id:thread,artifact_id:'report',version:999}}:state;frame.contentWindow.postMessage({type:'pero:app:context',context:{locale:'zh-CN',dark,active:true,artifactBrowser:data}},location.origin);document.body.classList.toggle('dark',dark);document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===state.view)));document.querySelector('#count').textContent=state.artifacts.length;const current=artifacts.find(item=>item.id===state.selected?.artifact_id);document.querySelector('#selection').textContent=current?current.title+' v'+state.selected.version:'未选择产物';}
addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;const message=event.data;if(message?.type==='pero:app:ready')publish();if(message?.type==='pero:artifact:select'){state.selected=message.target;publish();}if(message?.type==='pero:artifact:compose'){const valid=!reject&&message.target.thread_id===thread&&artifacts.some(item=>item.id===message.target.artifact_id&&item.versions.some(version=>version.version===message.target.version));if(valid)document.querySelector('#draft').value+=message.text+'\\n';frame.contentWindow.postMessage({type:'pero:app:chat-result',id:message.id,ok:valid,value:{threadId:thread},error:valid?'':'合成回执：原会话暂不可用'},location.origin);reject=false;}});
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{state.view=button.dataset.view;localStorage.setItem('artifact-browser-fixture-view',state.view);publish();});
document.querySelector('#theme').onclick=()=>{dark=!dark;publish();};document.querySelector('#all').onclick=()=>{all=!all;publish();};document.querySelector('#empty').onclick=()=>{empty=true;publish();};document.querySelector('#invalid').onclick=()=>{invalid=true;publish();};document.querySelector('#refresh').onclick=()=>{empty=false;invalid=false;state.selected={thread_id:thread,artifact_id:'report',version:2};publish();};document.querySelector('#reject').onclick=()=>{reject=true;};document.querySelector('#whole').onclick=()=>{const current=artifacts.find(item=>item.id===state.selected?.artifact_id);if(current)document.querySelector('#draft').value+='关于 '+current.title+'（第 '+state.selected.version+' 版）\\n';};
</script></html>`;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
    if (path === '/host/sdk') return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ name: 'scientific-viewer', version: '0.4.0', permissions: { api: [], events: [], host: [] } }));
    if (path.startsWith('/host/artifacts/')) {
      const parts = path.split('/'), file = files.find(item => item.id === parts[4]), version = Number(parts[5]);
      if (parts[3] !== thread || !file?.texts[version - 1]) return response.writeHead(404).end('Snapshot unavailable');
      const bytes = Buffer.from(file.texts[version - 1]);
      return response.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': bytes.length,
        'X-Pero-Artifact-Name': encodeURIComponent(file.filename), 'X-Pero-Artifact-Sha256': createHash('sha256').update(bytes).digest('hex'), 'X-Pero-Artifact-Kind': file.media.kind }).end(bytes);
    }
    const file = path.startsWith('/fixture-icons/') ? resolve(root, 'test-results/artifact-finder-design/icons', path.split('/').at(-1)) : resolve(dist, decodeURIComponent(path).slice(1));
    if (!file.startsWith(dist + sep) && !file.startsWith(resolve(root, 'test-results/artifact-finder-design/icons') + sep)) return response.writeHead(404).end();
    const bytes = await readFile(file);
    return response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' })[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'" }).end(bytes);
  } catch (error) { response.writeHead(500).end(String(error.message)); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
console.log(`http://127.0.0.1:${server.address().port}/`);
try { for await (const line of createInterface({ input: process.stdin })) if (line === 'stop') break; }
finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
