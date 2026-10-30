// A zero-test or skipped real dependency check must never turn this gate green.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function requireTestPass(text, test) {
 const records=text.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
 const related=records.filter(r=>r.Test===test||r.Test?.startsWith(`${test}/`));
 if(related.some(r=>r.Action==='skip'||r.Action==='fail')||related.filter(r=>r.Test===test&&r.Action==='pass').length!==1)
  throw Error(`Required real test ${test} did not PASS fully (missing/skipped is failure)`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [file,test]=process.argv.slice(2);
 if(!file||!test)throw Error('Usage: require-test-pass.mjs JSONL TEST');
 requireTestPass(await readFile(file,'utf8'),test);
}
