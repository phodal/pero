/** Web embedding never confers local-file authority. */
export class WebAddress {
  private value:URL;
  private constructor(value:URL) {this.value=value;}
  static parse(text:string):WebAddress {
    const value=new URL(text.trim());
    if(!['http:','https:'].includes(value.protocol)||!value.hostname)throw new Error('Only HTTP and HTTPS pages can be embedded');
    return new WebAddress(value);
  }
  get text():string {return this.value.href;}
  get title():string {return this.value.hostname;}
}
