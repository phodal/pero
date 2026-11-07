// Shared read-only GitHub CLI fixture for Host and real workbench acceptance.
import { existsSync, appendFileSync } from 'node:fs';
const args=process.argv.slice(2);
if(process.env.PERO_PR_CALLS) appendFileSync(process.env.PERO_PR_CALLS,JSON.stringify(args)+'\n');
if(process.env.PERO_PR_FAIL && existsSync(process.env.PERO_PR_FAIL)){console.error('Fixture GitHub unavailable');process.exit(1);}
const url='https://github.com/phodal/pero/pull/164';
if(args.join(' ')==='pr view --json url'){console.log(JSON.stringify({url}));process.exit(0);}
if(args[0]==='pr'&&args[1]==='list'){
  const state=args[args.indexOf('--state')+1];
  const open={number:164,title:'Retained pull request content',url:'https://github.com/phodal/pero/pull/164',author:{login:'phodal'},isDraft:false,state:'OPEN',additions:3,deletions:1};
  const draft={number:170,title:'Draft notes',url:'https://github.com/phodal/pero/pull/170',author:{login:'ada'},isDraft:true,state:'OPEN',additions:1,deletions:0};
  const closed={number:171,title:'Closed notes',url:'https://github.com/phodal/pero/pull/171',author:{login:'ada'},isDraft:false,state:'CLOSED',additions:0,deletions:2};
  const items=state==='closed'?[closed]:state==='all'?[open,draft,closed]:[open,draft];
  console.log(JSON.stringify(items));
  process.exit(0);
}
if(args[0]!=='api'||args[4]!=='GET'){console.error('Only read-only GitHub requests are allowed');process.exit(1);}
const path=args[5];let data;
if(path==='repos/phodal/pero/pulls/164')data={title:'Retained pull request content in the research workspace',body:'# Pull request review\n\nRecognize a GitHub link and review changes alongside the conversation.\n\n- Retained content during refresh\n- Independent checks and reviews\n\n[Same PR](https://github.com/Phodal/Pero/pull/164/files)',state:'closed',draft:false,merged:true,user:{login:'phodal'},base:{ref:'master',sha:'base'},head:{ref:'feature/pr-view',sha:'abcdef0123456789'},additions:3,deletions:1,changed_files:2};
else if(path.includes('/files?')) data=[{filename:'src/workspace.rs',previous_filename:null,status:'modified',additions:2,deletions:1,patch:'@@ -1,3 +1,4 @@\n fn main() {\n-    open_browser();\n+    open_pull_request();\n+    retain_conversation();\n }'},{filename:'README.md',previous_filename:null,status:'added',additions:1,deletions:0,patch:'@@ -0,0 +1 @@\n+# Pull request workspace'}];
else if(path.includes('/commits?'))data=[{sha:'abcdef0123456789',message:'feat(workspace): open a dedicated pull request view',author:'phodal'}];
else if(path.includes('/check-runs?'))data=[{name:'Rust checks',status:'completed',conclusion:'success',url:'https://github.com/phodal/pero/actions'},{name:'Browser inspection',status:'in_progress',conclusion:null,url:null}];
else if(path.includes('/statuses?'))data=[];
else if(path.includes('/reviews?'))data=[{author:'reviewer',state:'APPROVED',body:'The content stays available during refresh. Looks good.'}];
else if(path.includes('/comments?'))data=[{author:'phodal',state:'COMMENTED',body:'<p>Ready <code>review</code><img width="12" height="12" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"> now.</p><p>Another<img width="12" height="12" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"> paragraph.</p>'}];
else {console.error('Unexpected GitHub endpoint: '+path);process.exit(1);}
if(path==='repos/phodal/pero/pulls/164' && process.env.PERO_PR_WEB_URL) data.body=`[Supporting page](${process.env.PERO_PR_WEB_URL})\n\n${data.body}`;
console.log(JSON.stringify(data));
