// Shared GitHub CLI fixture. Mutations affect only the isolated fixture state.
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const args=process.argv.slice(2);
if(process.env.PERO_PR_CALLS) appendFileSync(process.env.PERO_PR_CALLS,JSON.stringify(args)+'\n');
if(process.env.PERO_PR_FAIL && existsSync(process.env.PERO_PR_FAIL)){console.error('Fixture GitHub unavailable');process.exit(1);}
const url='https://github.com/phodal/pero/pull/164';
const fields=Object.fromEntries(args.flatMap((value,index)=>['-f','-F','--field','--raw-field'].includes(args[index-1])?[[value.slice(0,value.indexOf('=')),value.slice(value.indexOf('=')+1)]]:[]));
const failure=process.env.PERO_PR_DISCUSSION_FAIL&&existsSync(process.env.PERO_PR_DISCUSSION_FAIL)?readFileSync(process.env.PERO_PR_DISCUSSION_FAIL,'utf8').trim():null;
const comment=(id,body,index,databaseId)=>({id,fullDatabaseId:String(databaseId),author:{login:index===1?'reviewer':'phodal'},body,url:`${url}#discussion_r${databaseId}`,createdAt:`2026-11-01T00:0${index}:00Z`,updatedAt:`2026-11-01T00:0${index}:00Z`,diffHunk:'@@ -1,3 +1,4 @@\n fn main() {\n-    open_browser();\n+    open_pull_request();\n+    retain_conversation();\n }',commit:{oid:'abcdef0123456789'},originalCommit:{oid:'original-head'}});
const current={id:'PRRT_current',path:'src/workspace.rs',line:3,originalLine:3,startLine:null,originalStartLine:null,diffSide:'RIGHT',startDiffSide:null,isOutdated:false,isResolved:false,viewerCanReply:true,viewerCanResolve:true,viewerCanUnresolve:false,comments:[comment('PRRC_current_1','Keep the conversation when opening this PR.',1,1001),comment('PRRC_current_2','The selected workspace must remain available.',2,1002)]};
const outdated={...current,id:'PRRT_outdated',line:null,originalLine:2,diffSide:'LEFT',isOutdated:true,isResolved:true,viewerCanReply:false,viewerCanResolve:false,viewerCanUnresolve:false,comments:[comment('PRRC_outdated_1','This old line also needs explanation.',1,2001)]};
const file={...current,id:'PRRT_file',path:'README.md',line:null,originalLine:null,comments:[comment('PRRC_file_1','Explain the retained view in this file.',1,3001)]};
const stateFile=process.env.PERO_PR_DISCUSSIONS;
const discussions=stateFile&&existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):[current,outdated,file];
const raw=discussion=>({...discussion,comments:{nodes:discussion.comments.slice(0,1),pageInfo:{hasNextPage:discussion.comments.length>1,endCursor:discussion.comments.length>1?'comment-1':null}}});
if(args[0]==='api'&&args.includes('graphql')){
  const operation=fields.operationName;
  const mutation=['ResolvePullRequestDiscussion','UnresolvePullRequestDiscussion'].includes(operation);
  if(['read','after_publish'].includes(failure)&&!mutation||failure==='comments'&&operation==='PullRequestDiscussionComments'||failure==='mutation'&&mutation){
    console.log(JSON.stringify({data:null,errors:[{message:'Fixture discussions unavailable'}]}));process.exit(0);
  }
  const id=fields.id??fields.discussionId??fields.threadId;
  const cursor=(fields.after??fields.endCursor)==='null'?null:fields.after??fields.endCursor;
  const page=(items,prefix)=>{
    const offset=cursor?Number(cursor.slice(prefix.length)):0;
    return {nodes:items.slice(offset,offset+1),pageInfo:{hasNextPage:offset+1<items.length,endCursor:offset+1<items.length?`${prefix}${offset+1}`:null}};
  };
  const selected=discussions.find(discussion=>discussion.id===id);
  let data;
  if(operation==='PullRequestDiscussions'){
    const threads=page(discussions,'thread-');
    data={repository:{pullRequest:{url,reviewThreads:{...threads,nodes:threads.nodes.map(raw)}}}};
  }else if(operation==='PullRequestDiscussion'){
    data={node:id==='PRRT_other'?{...raw(current),id,pullRequest:{url:'https://github.com/phodal/pero/pull/165'}}:selected?{...raw(selected),pullRequest:{url}}:null};
  }else if(operation==='PullRequestDiscussionComments'){
    data={node:selected?{comments:page(selected.comments,'comment-')}:null};
  }else if(mutation&&selected){
    selected.isResolved=operation==='ResolvePullRequestDiscussion';
    selected.viewerCanResolve=!selected.isResolved;
    selected.viewerCanUnresolve=selected.isResolved;
    const thread={id:selected.id,isResolved:selected.isResolved,viewerCanReply:selected.viewerCanReply,viewerCanResolve:selected.viewerCanResolve,viewerCanUnresolve:selected.viewerCanUnresolve};
    data={[selected.isResolved?'resolveReviewThread':'unresolveReviewThread']:{thread}};
    if(stateFile)writeFileSync(stateFile,JSON.stringify(discussions));
  }else{
    console.error(`Unexpected fixture GraphQL operation: ${operation}`);process.exit(1);
  }
  console.log(JSON.stringify({data}));process.exit(0);
}
if(args[0]==='api'&&args[4]==='POST'){
  if(failure==='mutation'){console.error('Fixture discussions unavailable');process.exit(1);}
  const path=args[5];let posted;
  if(path==='repos/phodal/pero/pulls/164/comments'){
    posted=comment(`PRRC_added_${discussions.length}`,fields.body,1,10000+discussions.length);
    discussions.push({...current,id:`PRRT_added_${discussions.length}`,path:fields.path,line:Number(fields.line),originalLine:Number(fields.line),startLine:fields.start_line?Number(fields.start_line):null,originalStartLine:fields.start_line?Number(fields.start_line):null,diffSide:fields.side,startDiffSide:fields.start_side??null,comments:[posted]});
  }else{
    const rootId=path.match(/^repos\/phodal\/pero\/pulls\/164\/comments\/(\d+)\/replies$/)?.[1];
    const selected=discussions.find(discussion=>discussion.comments[0].fullDatabaseId===rootId);
    if(!selected){console.error(`Unexpected fixture comment endpoint: ${path}`);process.exit(1);}
    posted=comment(`PRRC_reply_${selected.comments.length}`,fields.body,selected.comments.length+1,Number(rootId)+selected.comments.length);
    selected.comments.push(posted);
  }
  if(stateFile)writeFileSync(stateFile,JSON.stringify(discussions));
  console.log(JSON.stringify({id:Number(posted.fullDatabaseId),node_id:posted.id,user:posted.author,body:posted.body,html_url:posted.url,created_at:posted.createdAt,updated_at:posted.updatedAt,diff_hunk:posted.diffHunk,commit_id:posted.commit.oid,original_commit_id:posted.originalCommit.oid}));process.exit(0);
}
if(args.join(' ')==='pr view --json url'){console.log(JSON.stringify({url}));process.exit(0);}
if(args[0]==='pr'&&args[1]==='list'){
  const state=args[args.indexOf('--state')+1];
  const open={number:164,title:'Retained pull request content',url:'https://github.com/phodal/pero/pull/164',author:{login:'phodal'},isDraft:false,state:'OPEN',additions:3,deletions:1,createdAt:'2026-11-01T00:00:00Z',reviewDecision:'APPROVED',mergeStateStatus:'BLOCKED'};
  const draft={number:170,title:'Draft notes',url:'https://github.com/phodal/pero/pull/170',author:{login:'ada'},isDraft:true,state:'OPEN',additions:1,deletions:0,createdAt:'2026-11-02T00:00:00Z',reviewDecision:'REVIEW_REQUIRED',mergeStateStatus:'DRAFT'};
  const closed={number:171,title:'Closed notes',url:'https://github.com/phodal/pero/pull/171',author:{login:'ada'},isDraft:false,state:'CLOSED',additions:0,deletions:2,createdAt:'2026-10-01T00:00:00Z',reviewDecision:null,mergeStateStatus:'UNKNOWN'};
  const items=state==='closed'?[closed]:state==='all'?[open,draft,closed]:[open,draft];
  console.log(JSON.stringify(items));
  process.exit(0);
}
if(args[0]!=='api'||args[4]!=='GET'){console.error('Only read-only GitHub requests are allowed');process.exit(1);}
const path=args[5];let data;
if(path==='repos/phodal/pero/pulls/164')data={title:'Retained pull request content in the research workspace',body:'# Pull request review\n\nRecognize a GitHub link and review changes alongside the conversation.\n\n- Retained content during refresh\n- Independent checks and reviews\n\n[Same PR](https://github.com/Phodal/Pero/pull/164/files)',state:'closed',draft:false,merged:true,user:{login:'phodal'},base:{ref:'master',sha:'base'},head:{ref:'feature/pr-view',sha:'abcdef0123456789'},additions:3,deletions:1,changed_files:2,created_at:'2026-11-01T00:00:00Z',mergeable_state:'blocked'};
else if(path.includes('/files?')) data=[{filename:'src/workspace.rs',previous_filename:null,status:'modified',additions:2,deletions:1,patch:'@@ -1,3 +1,4 @@\n fn main() {\n-    open_browser();\n+    open_pull_request();\n+    retain_conversation();\n }'},{filename:'README.md',previous_filename:null,status:'added',additions:1,deletions:0,patch:'@@ -0,0 +1 @@\n+# Pull request workspace'}];
else if(path.includes('/commits?'))data=[{sha:'abcdef0123456789',message:'feat(workspace): open a dedicated pull request view',author:'phodal'}];
else if(path.includes('/check-runs?'))data=[{name:'Rust checks',status:'completed',conclusion:'success',url:'https://github.com/phodal/pero/actions'},{name:'Browser inspection',status:'in_progress',conclusion:null,url:null}];
else if(path.includes('/statuses?'))data=[];
else if(path.includes('/reviews?'))data=[{author:'reviewer',state:'APPROVED',body:'The content stays available during refresh. Looks good.'}];
else if(path.includes('/comments?'))data=[{author:'phodal',state:'COMMENTED',body:'<p>Ready <code>review</code><img width="12" height="12" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"> now.</p><p>Another<img width="12" height="12" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"> paragraph.</p>'}];
else {console.error('Unexpected GitHub endpoint: '+path);process.exit(1);}
if(path==='repos/phodal/pero/pulls/164' && process.env.PERO_PR_WEB_URL) data.body=`[Supporting page](${process.env.PERO_PR_WEB_URL})\n\n${data.body}`;
console.log(JSON.stringify(data));
