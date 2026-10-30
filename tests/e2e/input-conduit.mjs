// Platform evidence, separate from the GPUI integration and physical IME lanes.
import {expect} from '@playwright/test';
import {electron} from './electron.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const out=resolve(root,'test-results/input-conduit');await mkdir(out,{recursive:true});
const app=await electron.launch({args:[resolve(root,'tests/fixtures/input-conduit-app.cjs')],cwd:root});
try {
  const page=await app.firstWindow();
  const versions=await app.evaluate(()=>process.versions);
  const result=await page.evaluate(async()=>{
    const raf=()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
    const results=[];
    for(const rows of [8000,100000]) {
      const source=Array.from({length:rows},(_,i)=>`{"id":${i},"label":"中文 row ${i}","number":9007199254740993}`).join('\n');
      for(const kind of ['textarea','edit-context']) {
        if(kind==='edit-context'&&typeof EditContext!=='function')continue;
        const host=document.createElement(kind==='textarea'?'textarea':'div');
        host.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;white-space:pre;contain:strict;opacity:0;font-size:16px';
        if(kind==='textarea')host.wrap='off';
        document.body.append(host);
        const context=kind==='edit-context'?new EditContext():undefined;
        if(context)host.editContext=context;
        host.focus({preventScroll:true});await raf();
        const start=performance.now();
        if(context)context.updateText(0,0,source);else host.value=source;
        const valueDone=performance.now();
        if(context)context.updateSelection(0,source.length);else host.setSelectionRange(0,source.length);
        const selectionDone=performance.now();
        host.getBoundingClientRect();await raf();
        results.push({rows,kind,bytes:new TextEncoder().encode(source).length,utf16:source.length,
          valueMs:valueDone-start,selectionMs:selectionDone-valueDone,totalMs:performance.now()-start,
          exact:(context?context.text:host.value)===source,
          start:context?context.selectionStart:host.selectionStart,end:context?context.selectionEnd:host.selectionEnd});
        if(context)host.editContext=null;
        host.remove();await raf();
      }
    }
    return {supported:typeof EditContext==='function',results};
  });
  expect(result.supported).toBe(true);
  for(const sample of result.results){expect(sample.exact).toBe(true);expect(sample.start).toBe(0);expect(sample.end).toBe(sample.utf16);}
  const evidence={lane:'EditContext platform microbenchmark',gpui:false,physicalIme:false,versions,...result};
  await writeFile(resolve(out,'platform.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(result));
} finally {await app.close();}
