import {createServer} from 'node:http';
import {build} from 'esbuild';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/app-bridge';
import {z} from 'zod';
import {pathToFileURL} from 'node:url';

export async function startMcpFixture({authorization}:{authorization?:string}={}) {
  let counter=0,requests=0;
  const bundle=await build({entryPoints:[new URL('./view.ts',import.meta.url).pathname],bundle:true,platform:'browser',format:'iife',write:false,target:'es2022'});
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>MCP fixture</title></head><body><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`;
  const server=createServer(async(request,response)=>{
    if(request.url!=='/mcp'){response.writeHead(404).end();return;}
    if(authorization&&request.headers.authorization!==authorization){response.writeHead(403).end();return;}
    if(request.method!=='POST'){response.writeHead(405).end();return;}
    requests++;
    const mcp=new McpServer({name:'Pero MCP Apps fixture',version:'1.0.0'});
    mcp.registerResource('view','ui://fixture/view',{mimeType:RESOURCE_MIME_TYPE,_meta:{ui:{csp:{}}}},async()=>({contents:[{uri:'ui://fixture/view',mimeType:RESOURCE_MIME_TYPE,text:html,_meta:{ui:{csp:{}}}}]}));
    mcp.registerTool('show',{title:'Show fixture',inputSchema:{label:z.string()},_meta:{ui:{resourceUri:'ui://fixture/view'}}},async({label})=>({content:[{type:'text',text:label}],structuredContent:{label},_meta:{view_only:'retained'}}));
    mcp.registerTool('increment',{inputSchema:{by:z.number()},_meta:{ui:{visibility:['app']}}},async({by})=>({content:[],structuredContent:{counter:counter+=by}}));
    mcp.registerTool('model_only',{inputSchema:{},_meta:{ui:{visibility:['model']}}},async()=>({content:[]}));
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    response.once('close',()=>{void transport.close();void mcp.close();});
    try {let text='';for await(const chunk of request)text+=chunk;await mcp.connect(transport);await transport.handleRequest(request,response,JSON.parse(text));}
    catch(error){if(!response.headersSent)response.writeHead(500).end(String(error));}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('Fixture has no listener');
  return {endpoint:`http://127.0.0.1:${address.port}/mcp`,get requests(){return requests;},get counter(){return counter;},
    close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const fixture=await startMcpFixture();console.log(JSON.stringify({endpoint:fixture.endpoint}));
  process.once('SIGTERM',()=>{void fixture.close().finally(()=>process.exit(0));});
}
