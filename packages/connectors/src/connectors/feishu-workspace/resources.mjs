import { FeishuError } from './errors.mjs';
import {createHash} from 'node:crypto';
import {mkdtemp,open,lstat,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceReference,SOURCE_REFERENCE_PROTOCOL,resourceURL} from './reference.mjs';
import {parseCloudFile} from './file-parser.mjs';
const fail=code=>{throw new FeishuError(code)};
const token=v=>/^[A-Za-z0-9]{10,128}$/.test(v??'');
const cursor=v=>v===undefined||typeof v==='string'&&v.length<=16384&&!v.includes('\0');
const fields=(input,names)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!names.includes(k)))fail('FEISHU_ARGUMENT')};
export const digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const numericVersion=hash=>parseInt(hash.slice(7,19),16);
const requireScopes=async(client,scopes,options)=>{const a=await client.account(options);if(!scopes.every(s=>a.scopes.includes(s)))fail('FEISHU_PERMISSION');return a};
const reference=(client,type,id,url,version,selection,contentDigest)=>sourceReference({protocol:SOURCE_REFERENCE_PROTOCOL,provider:'feishu-workspace',connectionId:client.connectionId,tenantId:client.tenantId,appId:client.appId,userId:client.openId,resourceType:type,resourceId:id,url,version,selection,...(contentDigest?{contentDigest}:{})});
export async function browseResources(input={},options={}) {
  fields(input,['kind','token','spaceId','pageToken']);if(!cursor(input.pageToken)||!['folder','wiki-spaces','wiki-nodes'].includes(input.kind)||input.token&&!token(input.token)||input.spaceId&&!/^(my_library|\d{1,32})$/.test(input.spaceId))fail('FEISHU_ARGUMENT');
  let result;
  if(input.kind==='folder') {
    await requireScopes(this,['drive:drive:readonly'],options);
    result=await this.read(['drive','files','list','--as','user','--format','json','--params',JSON.stringify({folder_token:input.token??'',page_size:20,...(input.pageToken?{page_token:input.pageToken}:{})})],options);
    result.data.items=(result.data.files??[]).flatMap(f=>{if(!token(f.token))return [];let url;try{url=f.type==='folder'?undefined:resourceURL(f.url)}catch{return []}return [{token:f.token,title:String(f.name??'').slice(0,160),type:f.type,url,modifiedAt:timestamp(f.modified_time)}]});
  } else {
    await requireScopes(this,[input.kind==='wiki-spaces'?'wiki:space:retrieve':'wiki:node:retrieve'],options);
    if(input.kind==='wiki-nodes'&&!input.spaceId)fail('FEISHU_ARGUMENT');
    result=await this.read(['wiki',input.kind==='wiki-spaces'?'+space-list':'+node-list','--as','user','--format','json','--page-size','20',...(input.kind==='wiki-nodes'?['--space-id',input.spaceId,...(input.token?['--parent-node-token',input.token]:[])]:[]),...(input.pageToken?['--page-token',input.pageToken]:[])],options);
    result.data.items=input.kind==='wiki-spaces'?(result.data.spaces??[]).map(s=>({type:'space',token:s.space_id,spaceId:s.space_id,title:s.name})):(result.data.nodes??[]).filter(n=>token(n.node_token)).map(n=>({type:n.obj_type,token:n.node_token,title:n.title,hasChildren:n.has_child===true,url:n.obj_type==='docx'?`https://www.feishu.cn/wiki/${n.node_token}`:['file','slides'].includes(n.obj_type)&&token(n.obj_token)?`https://www.feishu.cn/${n.obj_type==='file'?'drive/file':'slides'}/${n.obj_token}`:undefined,modifiedAt:timestamp(n.obj_edit_time)}));
  }
  return result;
}
export function timestamp(value) {const n=Number(value);if(!value||!Number.isFinite(n))return undefined;const ms=n<1e12?n*1000:n;try{return new Date(ms).toISOString()}catch{return undefined}}
export async function listChats(input={},options={}) {
  fields(input,['pageToken']);if(!cursor(input.pageToken))fail('FEISHU_ARGUMENT');await requireScopes(this,['im:chat:read'],options);
  const result=await this.read(['im','+chat-list','--as','user','--format','json','--types','group','--page-size','20',...(input.pageToken?['--page-token',input.pageToken]:[])],options);
  result.data.items=(result.data.chats??result.data.items??[]).filter(c=>/^oc_[A-Za-z0-9]{1,128}$/.test(c.chat_id??'')).map(c=>({type:'chat',token:c.chat_id,title:String(c.name??'').slice(0,160),url:`https://applink.feishu.cn/client/chat/open?openChatId=${c.chat_id}`}));return result;
}
export async function readChat(input={},options={}) {
  fields(input,['chatId','start','end','pageToken','messageId']);if(input.messageId&&!/^om_[A-Za-z0-9]+$/.test(input.messageId))fail('FEISHU_ARGUMENT');if(!/^oc_[A-Za-z0-9]{1,128}$/.test(input.chatId??'')||!cursor(input.pageToken)||typeof input.start!=='string'||typeof input.end!=='string'||!/^\d{4}-.*T.*(?:Z|[+-]\d\d:\d\d)$/.test(input.start)||!/^\d{4}-.*T.*(?:Z|[+-]\d\d:\d\d)$/.test(input.end)||!Number.isFinite(Date.parse(input.start))||Date.parse(input.end)<=Date.parse(input.start)||Date.parse(input.end)-Date.parse(input.start)>31*86400000)fail('FEISHU_ARGUMENT');
  await requireScopes(this,['im:chat:read','im:message:readonly'],options);
  const result=await this.read(['im','+chat-messages-list','--as','user','--format','json','--chat-id',input.chatId,'--start',input.start,'--end',input.end,'--order','asc','--page-size','50','--no-reactions',...(input.pageToken?['--page-token',input.pageToken]:[])],options);
  // Freeze one explicit page, not an implied complete chat history. Edits/recalls change its digest.
  const messages=(result.data.messages??[]).map(m=>({id:m.message_id,createdAt:m.create_time,updatedAt:m.update_time,deleted:m.deleted===true,updated:m.updated===true,senderType:m.sender?.sender_type??m.sender?.type,sender:m.sender?.name??m.sender?.id,type:m.msg_type,content:m.deleted?'[recalled]':m.content}));
  const chosen=input.messageId?messages.find(m=>m.id===input.messageId):null;if(input.messageId&&(!chosen||chosen.deleted))fail('FEISHU_VERSION_CONFLICT');
  const body=input.messageId?JSON.stringify({id:chosen.id,sender:chosen.sender,createdAt:chosen.createdAt,content:chosen.content}):JSON.stringify({messages,hasMore:result.data.has_more===true,nextPage:result.data.page_token??''});if(Buffer.byteLength(body)>65536)fail('FEISHU_OUTPUT_LIMIT');const hash=digest(body);
  result.reference=reference(this,'chat',input.chatId,`https://applink.feishu.cn/client/chat/open?openChatId=${input.chatId}`,numericVersion(hash),{scope:'range',start:input.start,end:input.end,...(input.messageId?{messageId:input.messageId}:{}),...(input.pageToken?{pageToken:input.pageToken}:{})},hash);
  result.data.document={content:body,document_id:input.chatId,revision_id:result.reference.version};return result;
}
export async function readResource(input={},options={}) {
  let pinned=input.reference;
  if(pinned){fields(input,['reference']);try{pinned=sourceReference(pinned)}catch{fail('FEISHU_REFERENCE')};if(pinned.connectionId!==this.connectionId||pinned.tenantId!==this.tenantId||pinned.appId!==this.appId||pinned.userId!==this.openId)fail('FEISHU_ACCOUNT_CHANGED');input={document:pinned.url,...pinned.selection};}
  if(pinned?.resourceType==='chat'){const r=await readChat.call(this,{...(pinned.selection.messageId?{messageId:pinned.selection.messageId}:{}),chatId:pinned.resourceId,start:pinned.selection.start,end:pinned.selection.end,...(pinned.selection.pageToken?{pageToken:pinned.selection.pageToken}:{})},options);if(r.reference.contentDigest!==pinned.contentDigest)fail('FEISHU_VERSION_CONFLICT');return r;}
  fields(input,['document','scope','blockId']);if(input.scope&&input.scope!=='full'||input.blockId)fail('FEISHU_ARGUMENT');let url;try{url=resourceURL(input.document)}catch{fail('FEISHU_REFERENCE')}
  let type=new URL(url).pathname.split('/')[1],id=new URL(url).pathname.split('/').at(-1),title='';
  if(type==='wiki') {await requireScopes(this,['wiki:node:retrieve'],options);const info=await this.read(['drive','+inspect','--as','user','--format','json','--url',url],options);type=info.data.type??info.data.doc_type;id=info.data.token??info.data.doc_token;title=info.data.title??'';if(!token(id)||!['file','slides'].includes(type))fail('FEISHU_FILE_UNSUPPORTED');url=`https://www.feishu.cn/${type==='file'?'drive/file':'slides'}/${id}`;}
  if(type==='drive')type='file';
  let result;
  if(type==='slides') {
    await requireScopes(this,['slides:presentation:read'],options);result=await this.read(['slides','+xml-get','--as','user','--format','json','--presentation',url],options);const content=result.data.xml_presentation?.content,version=result.data.revision_id;if(typeof content!=='string'||!Number.isSafeInteger(version))fail('FEISHU_RESPONSE');result.data.document={document_id:id,revision_id:version,content};result.reference=reference(this,'slides',id,url,version,{scope:'full'},digest(content));
  }else if(type==='file') {
    await requireScopes(this,['drive:drive:readonly'],options);
    const temp=await mkdtemp(join(tmpdir(),'point-feishu-read-'));const name=join(temp,'source');const controller=new AbortController();const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)controller.abort();let monitor;
    try {
      monitor=setInterval(()=>{void lstat(name).then(s=>{if(s.isSymbolicLink()||s.size>12*1048576)controller.abort()}).catch(()=>{})},25);
      try {result=await this.read(['drive','+download','--as','user','--format','json','--file-token',id,'--output','source'],{...options,signal:controller.signal,cwd:temp});} catch(error) {if(error.code!=='FEISHU_REQUEST')throw error;await rm(name,{force:true});result=await this.read(['drive','+preview','--as','user','--format','json','--file-token',id,'--type','source_file','--output','source'],{...options,signal:controller.signal,cwd:temp})}
      const file=await open(name,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;try{const stat=await file.stat();if(!stat.isFile()||stat.size>12*1048576)fail('FEISHU_OUTPUT_LIMIT');const buffer=Buffer.alloc(12*1048576+1);let length=0;while(length<buffer.length){const read=await file.read(buffer,length,buffer.length-length,null);if(!read.bytesRead)break;length+=read.bytesRead}if(length>12*1048576)fail('FEISHU_OUTPUT_LIMIT');bytes=buffer.subarray(0,length)}finally{await file.close()}const parsed=await parseCloudFile(bytes);await this.account(options);const hash=digest(bytes);result.image=parsed.image;result.mediaType=parsed.mediaType;result.data.document={document_id:id,revision_id:numericVersion(hash),content:parsed.content};result.reference=reference(this,'file',id,url,numericVersion(hash),{scope:'full'},hash);
    }finally{clearInterval(monitor);options.signal?.removeEventListener('abort',abort);await rm(temp,{recursive:true,force:true})}
  }else fail('FEISHU_FILE_UNSUPPORTED');
  if(title)result.title=title;
  if(pinned&&(pinned.version!==result.reference.version||pinned.contentDigest&&pinned.contentDigest!==result.reference.contentDigest))fail('FEISHU_VERSION_CONFLICT');return result;
}
