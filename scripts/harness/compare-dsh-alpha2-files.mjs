// Synthetic PNG swatches. The fixture never reads a project attachment.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const swatches = [
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgAQMAAABJtOi3AAAAA1BMVEX/AAAZ4gk3AAAADElEQVQI12NgGNwAAACgAAFhJX1HAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgAQMAAABJtOi3AAAAA1BMVEUAAP+KeNJXAAAADElEQVQI12NgGNwAAACgAAFhJX1HAAAAAElFTkSuQmCC',
];
const beta = 'files-api-2025-04-14';

export function createFilesFixture(key) {
  const uploads = [];
  const inference = [];
  return {uploads, inference, async handle(req, res) {
    assert.equal(req.method, 'POST');
    const credential = req.headers['x-api-key'];
    assert.ok([key, key+'-new'].includes(credential));
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      assert.ok(length <= 2 * 1024 * 1024);
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    if (req.url === '/v1/files') {
      const boundary = /^multipart\/form-data; boundary=(.+)$/.exec(req.headers['content-type'])?.[1];
      assert.ok(boundary);
      assert.equal(req.headers['anthropic-beta'], beta);
      assert.ok(raw.includes('name="expires_after[seconds]"'));
      const part = raw.toString('latin1').split('--' + boundary).find(s => s.includes('name="file"'));
      assert.ok(part);
      const [headers, ...body] = part.split('\r\n\r\n');
      const image = Buffer.from(body.join('\r\n\r\n').slice(0, -2), 'latin1');
      const mime = /content-type: (image\/[^\r]+)/i.exec(headers)?.[1];
      assert.equal(mime, 'image/png');
      const id = `file-fixture-${uploads.length + 1}`;
      uploads.push({id, credential, image});
      res.setHeader('content-type', 'application/json');
      if (credential !== key && uploads.length === 4) {
        res.statusCode = 400;
        res.end(JSON.stringify({error:{message:'synthetic upload rejection'}}));
      } else {
        res.end(JSON.stringify({
          id, type:'file', created_at:new Date().toISOString(), mime_type:mime,
          size_bytes:image.length, filename:id+'.png',
        }));
      }
      return;
    }
    assert.equal(req.url, '/v1/messages');
    const body = JSON.parse(raw);
    assert.equal(body.model, 'deepseek-flash');
    const sources = body.messages.flatMap(m => Array.isArray(m.content)
      ? m.content.filter(b => b.type === 'image').map(b => b.source) : []);
    assert.equal(sources.length, 2);
    inference.push({credential, sources, beta:req.headers['anthropic-beta']});
    res.writeHead(200, {'content-type':'text/event-stream'});
    const send = obj => res.write(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`);
    send({type:'message_start',message:{id:'fixture',type:'message',role:'assistant',model:body.model,content:[],usage:{input_tokens:3,output_tokens:0}}});
    send({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
    send({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'synthetic response'}});
    send({type:'content_block_stop',index:0});
    send({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}});
    send({type:'message_stop'});
    res.end();
  }};
}

export async function compareDSHFiles({root, dshEntry, key, withAgent, fixture}) {
  const home = join(root,'dsh-files');
  const workspace = join(home,'workspace');
  const patch = join(home,'vision.yml');
  await mkdir(workspace,{recursive:true});
  // Alpha.2's stock ACP model ID is not the image-capable catalog entry.
  await writeFile(patch, '- id: acp\n  config:\n    provider: deepseek-official\n    model: deepseek-flash\n- id: llm-deepseek\n  config:\n    fileUploadConcurrency: 1\n');
  const engine = {name:'dsh',command:process.execPath,args:() => [dshEntry,'--profile','acp','--patch',patch]};
  const {uploads, inference} = fixture;
  const run = createImageSessions(withAgent, {home, workspace}, fixture);
  const id = await run(engine);
  assert.equal(uploads.length,2);
  assert.notDeepEqual(uploads[0].image,uploads[1].image);
  assert.deepEqual(inference[0].sources.map(s => s.file_id),uploads.map(u => u.id));
  assert.ok(inference[0].beta?.includes(beta));
  await run(engine,id);
  assert.equal(uploads.length,2);
  assert.deepEqual(inference[1].sources,inference[0].sources);
  await run({...engine,credential:key+'-new'},id);
  assert.deepEqual(uploads.map(u => u.credential),[key,key,key+'-new',key+'-new']);
  assert.equal(inference.length,3);
  assert.equal(inference[2].credential,key+'-new');
  assert.ok(!inference[2].beta?.includes(beta));
  assert.deepEqual(inference[2].sources.map(s => s.type),['base64','base64']);
  assert.deepEqual(inference[2].sources.map(s => Buffer.from(s.data,'base64')),uploads.slice(2).map(u => u.image));
  return {scope:'DSH-only loopback Files baseline',uploads:uploads.length,
    inference:inference.map(r => r.sources.map(i => i.type)),sameIdsAfterRestart:true};
}


function createImageSessions(withAgent, paths, fixture) {
  const params = {cwd:paths.workspace, mcpServers:[]};
  const {uploads,inference} = fixture;
  return (agent, originalID) => withAgent(agent, paths,async ({request,capabilities}) => {
    assert.equal(capabilities.promptCapabilities.image,true);
    let sessionId = originalID;
    if (sessionId) {
      const before = [uploads.length, inference.length];
      await request('session/resume', {...params, sessionId});
      assert.deepEqual([uploads.length, inference.length], before, 'resume alone sent provider traffic');
    } else {
      ({sessionId} = await request('session/new',params));
    }
    const prompt = [{type:'text', text:'Describe the two synthetic swatches.'}];
    if (!originalID) prompt.push(...swatches.map(data => ({type:'image',mimeType:'image/png',data})));
    assert.equal((await request('session/prompt',{sessionId,prompt})).stopReason,'end_turn');
    await request('session/close',{sessionId});
    return sessionId;
  });
}

export async function comparePeroImages({root, peroBinary, withAgent, fixture}) {
  const home = join(root, 'pero-images');
  const workspace = join(home, 'workspace');
  await mkdir(workspace, {recursive:true});
  const engine = {name:'pero', command:peroBinary, args:({endpoint}) => [
    '--endpoint', endpoint+'/v1/messages', '--api-format', 'deepseek-messages',
    '--model', 'deepseek-flash', '--image-input', '--max-tokens', '128',
    '--api-key-env', 'PERO_FIXTURE_API_KEY', '--session-dir', join(home,'sessions'),
  ]};
  const {uploads, inference} = fixture;
  const run = createImageSessions(withAgent, {home, workspace}, fixture);
  const id = await run(engine);
  await run(engine, id);
  assert.equal(uploads.length, 0);
  assert.equal(inference.length, 2);
  for (const row of inference) {
    assert.ok(!row.beta?.includes(beta));
    assert.deepEqual(row.sources.map(s => s.type), ['base64', 'base64']);
    assert.ok(row.sources.every(s => /^image\/(png|jpeg)$/.test(s.media_type) && s.data));
    assert.notEqual(row.sources[0].data, row.sources[1].data);
  }
  assert.deepEqual(inference[1].sources, inference[0].sources);
  return {scope:'Pero-only inline Messages images', uploads:0, inference:2, sameImagesAfterRestart:true};
}
