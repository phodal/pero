// Project only immutable image references from Helm's private rendered output.
// This is the existing pinned-chart image gate, not a general YAML sanitizer.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function ciliumImageReceipt(manifest) {
 const lines=manifest.split('\n').filter(line=>/^\s+(?:-\s+)?image:/.test(line));
 if(!lines.length)throw Error('Cilium image digest is absent');
 const images=lines.map(line=>{
  const match=line.match(/^\s+(?:-\s+)?image:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))\s*(?:#.*)?$/);
  const image=match&&(match[1]??match[2]??match[3]);
  if(!image||!/^[-A-Za-z0-9._/:]+@sha256:[a-f0-9]{64}$/.test(image))
   throw Error('Cilium image digest is absent or malformed');
  return image;
 });
 return {kind:'cilium-image-pins',images:[...new Set(images)].sort()};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [file]=process.argv.slice(2);
 if(!file)throw Error('Usage: cilium-evidence.mjs PRIVATE_MANIFEST');
 // Validate every image before emitting anything; never echo the source on error.
 process.stdout.write(JSON.stringify(ciliumImageReceipt(await readFile(file,'utf8')))+'\n');
}
