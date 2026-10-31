/** Point-owned immutable external citation, shared by Viewer, composer and MCP. */
export const SOURCE_REFERENCE_PROTOCOL = 'point.source-reference.v1';
export function resourceURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('FEISHU_REFERENCE'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/(^|\.)(feishu\.cn|larkoffice\.com|larksuite\.com)$/.test(url.hostname) ||
      !(url.hostname==='applink.feishu.cn' && url.pathname==='/client/chat/open' && /^oc_[A-Za-z0-9]{1,128}$/.test(url.searchParams.get('openChatId')??'') && [...url.searchParams.keys()].length===1 || /^\/(?:(docx|wiki|slides)\/[A-Za-z0-9]{10,128}|drive\/file\/[A-Za-z0-9]{10,128})\/?$/.test(url.pathname))) throw new Error('FEISHU_REFERENCE');
  return url.origin + url.pathname.replace(/\/$/, '') + (url.pathname==='/client/chat/open' ? '?openChatId='+url.searchParams.get('openChatId') : '');
}
export function sourceReference(input) {
  if (!input || input.protocol !== SOURCE_REFERENCE_PROTOCOL || input.provider !== 'feishu-workspace' ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(input.connectionId ?? '') || !/^[A-Za-z0-9_-]{1,128}$/.test(input.tenantId ?? '') ||
      !/^cli_[A-Za-z0-9]+$/.test(input.appId ?? '') || !/^ou_[A-Za-z0-9]+$/.test(input.userId ?? '') ||
      !['docx', 'wiki', 'file', 'slides', 'chat'].includes(input.resourceType) || !(input.resourceType === 'chat' ? /^oc_[A-Za-z0-9]{1,128}$/ : /^[A-Za-z0-9]{10,128}$/).test(input.resourceId ?? '') ||
      !Number.isSafeInteger(input.version) || input.version < 0) throw new Error('FEISHU_REFERENCE');
  const url = resourceURL(input.url);
  const match = new URL(url).pathname.split('/');
  if ((input.resourceType==='chat' ? new URL(url).pathname!=='/client/chat/open'||new URL(url).searchParams.get('openChatId')!==input.resourceId : input.resourceType==='file' ? match[1]!=='drive'||match[2]!=='file'||match[3]!==input.resourceId : match[1] !== input.resourceType || match[2] !== input.resourceId)) throw new Error('FEISHU_REFERENCE');
  const selection = input.selection;
  const range = input.resourceType==='chat' && selection?.scope==='range' && typeof selection.start==='string' && typeof selection.end==='string' && /^\d{4}-.*T.*(?:Z|[+-]\d\d:\d\d)$/.test(selection.start) && /^\d{4}-.*T.*(?:Z|[+-]\d\d:\d\d)$/.test(selection.end) && Number.isFinite(Date.parse(selection.start)) && Date.parse(selection.end)>Date.parse(selection.start) && Date.parse(selection.end)-Date.parse(selection.start)<=31*86400000 && (!selection.messageId || /^om_[A-Za-z0-9]+$/.test(selection.messageId)) && (!selection.pageToken || typeof selection.pageToken==='string' && selection.pageToken.length<=16384);
  if (!range && (!selection || !['outline', 'full', 'section'].includes(selection.scope) ||
      (selection.scope === 'section' ? !/^[A-Za-z0-9_-]{1,128}$/.test(selection.blockId ?? '') : selection.blockId !== undefined))) throw new Error('FEISHU_REFERENCE');
  if (input.resourceType==='chat'&&!range || ['file','slides'].includes(input.resourceType)&&selection.scope!=='full' || ['file','chat'].includes(input.resourceType)&&!input.contentDigest) throw new Error('FEISHU_REFERENCE');
  // Discard unknown fields, including credentials, rather than serializing them.
  return Object.freeze({ protocol: SOURCE_REFERENCE_PROTOCOL, provider: 'feishu-workspace', connectionId: input.connectionId,
    tenantId: input.tenantId, appId: input.appId, userId: input.userId, resourceType: input.resourceType, resourceId: input.resourceId,
    url, version: input.version, ...(input.contentDigest ? {contentDigest:/^sha256:[a-f0-9]{64}$/.test(input.contentDigest)?input.contentDigest:(()=>{throw new Error('FEISHU_REFERENCE')})()} : {}), selection: Object.freeze(range ? {scope:'range',start:selection.start,end:selection.end,...(selection.messageId?{messageId:selection.messageId}:{}),...(selection.pageToken?{pageToken:selection.pageToken}:{})} : { scope: selection.scope, ...(selection.blockId ? { blockId: selection.blockId } : {}) }) });
}
export function referencePrompt(value) {
  const ref = sourceReference(value);
  return `\n<point-source-reference>${JSON.stringify(ref)}</point-source-reference>\n`;
}
