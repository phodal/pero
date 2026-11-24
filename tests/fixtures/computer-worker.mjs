// A second process implementation of the native seam, for transport failures.
import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync } from 'node:fs';
const [output, mode] = process.argv.slice(2);
const fixture = JSON.parse(readFileSync(new URL('../contracts/computer-use.json',import.meta.url),'utf8'));
const status = { available: true, accessibility: 'granted', screen_recording: 'granted', message: 'Fixture' };
for await (const line of createInterface({input:process.stdin})) {
  const {id,request} = JSON.parse(line);
  let value;
  if(request.operation==='status') value={kind:'status',status};
  else if(request.operation==='targets') value={kind:'targets',capabilities:fixture.capabilities,targets:[fixture.target]};
  else if(request.operation==='screenshot') {
    const media_type = 'image/png';
    value = {
      kind: 'observation',
      observation: { ...fixture.observation, elements: [], screenshot: { id: 'fixture-image', media_type, width: 1, height: 1 } },
      capture_status: 'captured',
      ocr_status: request.recognize_text ? 'pending' : 'not_requested',
      image: { media_type, data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=' },
    };
  }
  else if(request.operation==='read_ocr') value={kind:'ocr',screenshot_id:request.screenshot_id,ocr_status:'ready',recognized_text:'车企实践 / Test Agent'};
  else if(request.operation==='observe') {
    value={kind:'observation',observation:fixture.observation,image:null};
    if (request.options?.want_image) {
      value.capture_status = 'captured';
      value.ocr_status = 'ready';
      const media_type = 'image/png';
      value.observation = {
        ...fixture.observation,
        screenshot: { id: 'fixture-image', media_type, width: 1, height: 1 },
        elements: Array.from({ length: 100 }, (_, index) => ({
          ...fixture.observation.elements[0],
          id: `control-${index}`,
          label: index === 99 ? 'Fixture focused editor' : 'fixture line '.repeat(30),
          ...(index === 99 ? {
            state: { enabled: true, secure: false, focused: true, value_settable: true, expanded: false },
            actions: ['set_value', 'perform_action'],
            semantic_actions: ['confirm'],
          } : index === 0 ? {
            label: 'Fixture disabled button',
            state: { enabled: false, secure: false, focused: false, value_settable: false },
            actions: [],
          } : {}),
        })),
      };
      value.image = { media_type, data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=' };
      value.recognized_text = '车企实践 / Test Agent';
    }
  }
  else if(request.operation==='act') {
    appendFileSync(output,JSON.stringify({pid:process.pid,action:request.action})+'\n');
    if(mode==='interrupt') continue; // The caller observes the effect before cancelling.
    value={kind:'receipt',receipt:{request_id:request.action.request_id,target:request.action.target,observation_id:request.action.observation_id,outcome:{status:'executed'}}};
  }
  process.stdout.write(JSON.stringify({id,value})+'\n');
}
