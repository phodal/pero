import type { ContentFormat, DocumentHeader, ReaderLocation } from '../../protocol/generated/host';
export type AppDocumentInput = { id: string; title: string; text: string; format: ContentFormat; location?: ReaderLocation };

/** One installed App panel owns its revision namespace; callers cannot choose an origin. */
export class AppDocuments {
  private sources=new Map<string,{text:string;format:string;revision:number}>();
  private app:string;private panel:string;
  constructor(app:string,panel:string) {this.app=app;this.panel=panel;}
  admit(value:unknown):{header:DocumentHeader;text:string;location?:ReaderLocation} {
    if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid document');
    const input=value as Record<string,unknown>;
    if(Object.keys(input).some(key=>!['id','title','text','format','location'].includes(key)) || typeof input.id!=='string' || !input.id || input.id.length>256 || typeof input.title!=='string' || !input.title || input.title.length>512 || typeof input.text!=='string' || input.text.length>16_000_000)throw new Error('Invalid document source');
    const location=input.location as ReaderLocation|undefined;
    if(location!==undefined && (!location || typeof location!=='object' || Array.isArray(location) || Object.keys(location).some(key=>key!=='record') || !Number.isInteger(location.record) || location.record<0 || location.record>0xffffffff))throw new Error('Invalid document location');
    const format=input.format as Record<string,unknown>;
    if(!format || typeof format!=='object' || Array.isArray(format) || !['json','json_lines','text','markdown','code'].includes(String(format.kind)) || Object.keys(format).some(key=>!['kind','language'].includes(key)) || (format.kind==='code' ? typeof format.language!=='string' || !format.language || format.language.length>64 : format.language!==undefined))throw new Error('Invalid document format');
    const encoded=JSON.stringify(format), previous=this.sources.get(input.id);
    const revision=previous ? previous.revision+Number(previous.text!==input.text || previous.format!==encoded) : 1;
    this.sources.set(input.id,{text:input.text,format:encoded,revision});
    return {header:{source:{id:JSON.stringify([this.app,this.panel,input.id]),title:input.title,origin:{kind:'app',app:this.app,panel:this.panel}},revision,format:input.format as ContentFormat},text:input.text,...(location===undefined?{}:{location:{record:location.record}})};
  }
}
