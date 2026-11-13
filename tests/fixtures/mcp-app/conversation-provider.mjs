// Local model fixture: tool execution still belongs to the real Go harness/MCP server.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';

export const officialConversationPrompt='Show the current server time using the connected official tool.';
export const officialViewMessage='OFFICIAL_VIEW_MESSAGE: explain this time result.';
export const officialInitialAnswer='OFFICIAL_INITIAL_RESULT_OK';
export const officialFollowupAnswer='OFFICIAL_VIEW_FOLLOWUP_OK';

export async function officialConversationProvider(){
  const calls=[],errors=[];
  const server=createServer(async(request,response)=>{
    try{
      assert.equal(request.url,'/v1/chat/completions');
      let text='';for await(const chunk of request)text+=chunk;
      const body=JSON.parse(text);calls.push(body);
      const latestUser=body.messages.filter(message=>message.role==='user').at(-1);
      const prompt=typeof latestUser?.content==='string'?latestUser.content:
        latestUser?.content?.filter(part=>part.type==='text').map(part=>part.text).join('\n')||'';
      let delta,finish;
      if(calls.length===1){
        assert(prompt.includes(officialConversationPrompt));
        const tool=body.tools.find(tool=>/get[-_]time$/.test(tool.function?.name));
        assert(tool,`Missing official get-time: ${body.tools.map(tool=>tool.function?.name).join(', ')}`);
        delta={tool_calls:[{index:0,id:'official-time-call',type:'function',function:{name:tool.function.name,arguments:'{}'}}]};
        finish='tool_calls';
      }else if(calls.length===2){
        assert(body.messages.some(message=>message.role==='tool'),'The real MCP tool result must reach the model');
        delta={content:officialInitialAnswer};finish='stop';
      }else{
        assert.equal(calls.length,3,'The view message must enter exactly one subsequent model request');
        assert(prompt.includes(officialViewMessage),'ui/message did not become a real user prompt');
        delta={content:officialFollowupAnswer};finish='stop';
      }
      response.writeHead(200,{'Content-Type':'text/event-stream'});
      response.end(`data: ${JSON.stringify({id:`official-${calls.length}`,object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta,finish_reason:finish}]})}\n\ndata: [DONE]\n\n`);
    }catch(error){errors.push(String(error));response.writeHead(500).end('Official conversation fixture failed');}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  return {calls,errors,endpoint:`http://127.0.0.1:${server.address().port}/v1`,
    close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));}};
}
