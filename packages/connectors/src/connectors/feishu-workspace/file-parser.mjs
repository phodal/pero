import { FeishuError } from './errors.mjs';
import {unzipSync} from 'fflate';
const fail=()=>{throw new FeishuError('FEISHU_FILE_UNSUPPORTED')};
const limit=text=>{if(Buffer.byteLength(text)>65536)throw new FeishuError('FEISHU_OUTPUT_LIMIT');return text};
export async function parseCloudFile(bytes) {
  const head=bytes.subarray(0,16);
  let mediaType;
  if(head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mediaType='image/png';
  else if(head[0]===255&&head[1]===216&&head[2]===255)mediaType='image/jpeg';
  else if(head.subarray(0,4).toString()==='RIFF'&&head.subarray(8,12).toString()==='WEBP')mediaType='image/webp';
  if(mediaType){if(bytes.length>2*1048576)fail();return {mediaType,content:`Image (${mediaType}), ${bytes.length} bytes. Use the attached image for visual analysis.`,image:`data:${mediaType};base64,${bytes.toString('base64')}`}}
  if(head.subarray(0,5).toString()==='%PDF-') {
    // Bundle the worker into the pinned helper; never load remote fonts or scripts.
    globalThis.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true});
    try{const pdf=await task.promise;if(pdf.numPages>100)fail();let text='';for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),data=await page.getTextContent();text=limit(text+`\n[Page ${i}]\n`+data.items.map(v=>v.str??'').join(' '));page.cleanup();}if(!text.replace(/\[Page \d+\]/g,'').trim())fail();return {mediaType:'application/pdf',content:text};}finally{await task.destroy()}
  }
  if(head[0]===80&&head[1]===75) {
    let total=0;
    const files=unzipSync(new Uint8Array(bytes),{filter:f=>{if(/^ppt\/slides\/slide\d+\.xml$/.test(f.name)){total+=f.originalSize;if(total>2*1048576)fail();return true}return false}});
    const names=Object.keys(files).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));if(!names.length||names.length>100)fail();
    const entity=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
    const text=names.map((n,i)=>{const xml=new TextDecoder('utf-8',{fatal:true}).decode(files[n]);if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail();return `[Slide ${i+1}]\n`+[...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(m=>entity(m[1])).join('\n')}).join('\n\n');
    return {mediaType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',content:limit(text)};
  }
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail()};if(text.includes('\0')||/[\x01-\x08\x0B\x0C\x0E-\x1F]/.test(text))fail();return {mediaType:'text/plain',content:limit(text)};
}
