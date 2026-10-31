import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {quoteMatches,cropRect,sha256,emptyEvidence,evidenceZip,reviewPrompt,saveEvidence} from '../ui-src/evidence.ts';
test('exact quotations retain original offsets and whitespace without invented matches',()=>{
 const text='α 😀 first\n  result. first result.';
 const found=quoteMatches(text,'first result.');assert.equal(found.length,2);
 for(const match of found)assert.equal(text.slice(match.start,match.end),match.text);
 assert.equal(found[0].text,'first\n  result.');assert.deepEqual(quoteMatches(text,'absent'),[]);
 assert.throws(()=>quoteMatches(text,' '));assert.throws(()=>quoteMatches(text,'x'.repeat(4001)));
});
test('crop bounds normalize backwards selections and reject invalid or tiny regions',()=>{
 assert.deepEqual(cropRect([80,60],[-10,10],100,100),[0,10,80,50]);
 assert.throws(()=>cropRect([NaN,0],[20,20],100,100));assert.throws(()=>cropRect([0,0],[2,2],100,100));
});
test('export preserves original PDF and figure bytes, hashes and unreviewed provenance',async()=>{
 const bytes=new TextEncoder().encode('%PDF synthetic original'),png=new Uint8Array([1,2,3,4]);
 const file={id:'one',name:'../../escape.pdf',bytes,sha256:await sha256(bytes),source:'synthetic test',license:'CC0-1.0'};
 const evidence={...emptyEvidence(file.sha256),quotes:[{id:'q',page:1,text:'Exact source',start:0,end:12,pageTextSha256:'b'.repeat(64)}],crops:[{id:'c',page:1,rect:[0,0,10,10],width:100,height:100,png,sha256:await sha256(png)}],review:{requestId:'r',agentId:'fixture',prompt:'selected quotes only',cursor:1,status:'completed',text:'Previously invented conclusion'}};
 const archive=unzipSync(await evidenceZip(file,evidence));assert.deepEqual(archive['source/document.pdf'],bytes);assert.deepEqual(archive['figures/figure-1.png'],png);
 assert.ok(Object.keys(archive).every(path=>!path.includes('..')));
 const manifest=JSON.parse(strFromU8(archive['manifest.json']));assert.equal(manifest.status,'unreviewed');assert.equal(manifest.review.authority,'agent-generated-unreviewed');assert.equal(manifest.source.sha256,file.sha256);
 const prompt=reviewPrompt(file,evidence);assert.ok(prompt.includes('Exact source'));assert.ok(prompt.includes(file.sha256));assert.ok(!prompt.includes('%PDF'));assert.ok(!prompt.includes('Previously invented conclusion'));
 assert.throws(()=>reviewPrompt(file,emptyEvidence(file.sha256)));assert.throws(()=>reviewPrompt(file,{...evidence,sourceSha256:'wrong'}));
 await assert.rejects(evidenceZip({...file,bytes:new Uint8Array([7])},evidence),/digest/);
 await assert.rejects(evidenceZip(file,{...evidence,crops:[{...evidence.crops[0],sha256:'wrong'}]}),/digest/);
});
test('evidence budgets reject before opening local persistence',async()=>{
 const value=emptyEvidence('a'.repeat(64)),quote={id:'q',page:1,text:'x',start:0,end:1,pageTextSha256:'b'.repeat(64)};
 await assert.rejects(saveEvidence({...value,quotes:Array(51).fill(quote)}),/50 quotations/);
 await assert.rejects(saveEvidence({...value,quotes:[{...quote,text:'x'.repeat(20001)}]}),/20,000/);
 await assert.rejects(saveEvidence({...value,crops:Array(21).fill({})}),/20 figure/);
 await assert.rejects(saveEvidence({...value,crops:[{png:new Uint8Array(20*1024*1024+1)}]}),/20 MiB/);
});
