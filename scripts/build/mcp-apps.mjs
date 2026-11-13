import {build} from 'esbuild';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {appSdkAliases} from './app-sdk.mjs';

/** Self-contained standard UI resource; no runtime CDN or Node in the iframe. */
export async function buildMcpApps(directory) {
  const root=resolve(import.meta.dirname, '../..');
  const appRoot=resolve(root,'apps/notebook');
  const result=await build({entryPoints:[resolve(root,'apps/notebook/mcp/inspector.tsx')],
    bundle:true, platform:'browser', format:'iife', write:false, minify:true,
    outfile:'inspector.js', target:'es2022', jsx:'automatic', alias:appSdkAliases(root),
    plugins:[{name:'inspector-react-runtime',setup(builder){
      // The App and public controls must share the App's single React instance.
      builder.onResolve({filter:/^(react|react-dom)(\/|$)/},args=>{
        if(args.resolveDir===appRoot)return;
        return builder.resolve(args.path,{kind:args.kind,resolveDir:appRoot});
      });
    }}]});
  await mkdir(directory,{recursive:true});
  const script=result.outputFiles.find(file=>file.path.endsWith('.js')).text.replaceAll('</script','<\\/script');
  const css=result.outputFiles.find(file=>file.path.endsWith('.css'))?.text || '';
  await writeFile(resolve(directory,'notebook-inspector.html'),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notebook Inspector</title><style>${css}</style></head><body style="margin:0"><div id="app"></div><script>${script}</script></body></html>`);
}
