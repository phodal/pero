// Loopback model fixture; every advertised tool executes in the real harness.
import {createServer} from 'node:http';
import {once} from 'node:events';

export const scientificAnswer = String.raw`The model uses $x_{t+1}=Ax_t+Bu_t$ with explicitly supplied parameters.

### Model and constraints

$$
\rho\left(\frac{\partial\mathbf{u}}{\partial t}+\mathbf{u}\cdot\nabla\mathbf{u}\right)=-\nabla p+\mu\nabla^2\mathbf{u}+\mathbf{f}
$$

$$
\begin{aligned}\min_{\mathbf{u}_{0:T-1}}\quad&\sum_{t=0}^{T-1}\left(\mathbf{x}_t^\top Q\mathbf{x}_t+\mathbf{u}_t^\top R\mathbf{u}_t\right)\\\mathrm{s.t.}\quad&\mathbf{x}_{t+1}=A\mathbf{x}_t+B\mathbf{u}_t\end{aligned}
$$

$$
\begin{bmatrix}1&2\\3&4\end{bmatrix}\qquad X_{ij}\sim\operatorname{NB}(\mu_{ij},\theta_j)
$$

$$
\mathrm{2H_2+O_2\longrightarrow 2H_2O}
$$

Rendering does not establish the validity of these models. Invalid input remains local:

$$
\notACommand{x}
$$

SCIENTIFIC_CHAT_OK`;

export async function scientificProvider(source = '[{"method":"A","value":0.0100,"n":9007199254740993},{"method":"B","value":0,"n":0},{"method":"C","value":null}]') {
  const calls = [], errors = [];
  const dataset = {name:'results.json',content:source,format:'json'};
  const server = createServer(async(req,res)=>{
    try {
      let text=''; for await(const chunk of req) text+=chunk;
      const body=JSON.parse(text);
      for(const name of ['chart_render','table_render']) if(!body.tools.some(t=>t.function?.name===name)) throw Error(`Missing ${name}`);
      calls.push(body);
      const delta=calls.length===1?{tool_calls:[
        {index:0,id:'table-results',type:'function',function:{name:'table_render',arguments:JSON.stringify({dataset,tableDocument:{title:'Experimental results',description:'Supplied records; no statistical or dimensional check is claimed.',columns:[{field:'method',label:'Method'},{field:'value',label:'Tracking error',unit:'1'},{field:'n',label:'Samples'},...(JSON.parse(source).some(row=>'verification' in row)?[{field:'verification',label:'Reported checks'}]:[])]}})}},
        {index:1,id:'plot-results',type:'function',function:{name:'chart_render',arguments:JSON.stringify({dataset,chartDocument:{title:'Tracking error',chart:{type:'line',x:'method',y:'value'}}})}},
      ]}:{content:scientificAnswer};
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      res.end(`data: ${JSON.stringify({id:`science-${calls.length}`,object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta,finish_reason:calls.length===1?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
    }catch(error){errors.push(String(error));res.writeHead(500);res.end('fixture failed');}
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  return {server,calls,errors,endpoint:`http://127.0.0.1:${server.address().port}/v1`};
}
