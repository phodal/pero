import {WebAddress} from './web-address.ts';
/** Internal engine locations do not widen the HTTP-only address-entry contract. */
export class WebLocation {
  readonly text:string;
  private constructor(text:string){this.text=text;}
  static parse(text:string):WebLocation {
    if(text==='about:blank')return new WebLocation(text);
    const value=new URL(text);
    if(value.protocol==='pero-html:'&&value.hostname)return new WebLocation(value.href);
    return new WebLocation(WebAddress.parse(text).text);
  }
}
export function inlineHtml(value:unknown):{id:string;title:string;html:string} {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid HTML source');
  const source=value as Record<string,unknown>;
  if(Object.keys(source).length!==3||!['id','title','html'].every(key=>typeof source[key]==='string')||!source.id||String(source.id).length>4096||String(source.title).length>4096||new TextEncoder().encode(String(source.html)).length>16_000_000)throw new Error('Invalid HTML source');
  return source as {id:string;title:string;html:string};
}
