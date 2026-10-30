import { associations, canonicalIconName, type BundledIconName } from './content-data.generated.js';
import type {IconThemePackage} from './theme';
export type ContentIconKind = keyof typeof associations.kinds;
export type ContentIconInput = { kind?: ContentIconKind; language?: string; path?: string; app?: string; dark?: boolean };
export type ContentIconAssociation = { type: keyof typeof associations; value: string };
type ThemeIcon = { light: BundledIconName; dark: BundledIconName };
export type ContentIconArtwork={kind:'bundled';name:BundledIconName}|{kind:'svg';id:string;src:string;monochrome:boolean};

/** Source precedence is shared by built-in, extension and installed associations. */
function resolveWith<T>(input:ContentIconInput,lookup:(type:keyof typeof associations,value:string,dark:boolean)=>T|undefined):T|undefined {
  const dark=input.dark??false,kind=input.kind??'file';
  if(kind==='app'||input.app!==undefined)return lookup('apps',input.app??'',dark)??lookup('kinds','app',dark);
  if(input.language){const icon=lookup('languages',input.language,dark);if(icon!==undefined)return icon;}
  if(!['file','text','code'].includes(kind))return lookup('kinds',kind,dark);
  const filename=(input.path??'').split(/[\\/]/).at(-1)!.toLowerCase();
  const exact=lookup('filenames',filename,dark);if(exact!==undefined)return exact;
  for(let dot=filename.indexOf('.');dot>=0;dot=filename.indexOf('.',dot+1)){
    const icon=lookup('extensions',filename.slice(dot+1),dark);if(icon!==undefined)return icon;
  }
  return lookup('kinds',kind,dark);
}
export class ContentIconRegistry {
  private overrides = new Map<string, ThemeIcon>();
  private theme:IconThemePackage|null=null;
  private artworkByGlyph=new Map<string,{light:ContentIconArtwork;dark:ContentIconArtwork}>();
  register(association: ContentIconAssociation, light: string, dark = light): void {
    const key = this.key(association);
    const lightIcon = canonicalIconName(light), darkIcon = canonicalIconName(dark);
    if (!lightIcon || !darkIcon) throw new Error('Content icons must use a bundled glyph');
    this.overrides.set(key, { light: lightIcon, dark: darkIcon });
  }
  remove(association: ContentIconAssociation): boolean { return this.overrides.delete(this.key(association)); }
  private key({ type, value }: ContentIconAssociation): string {
    let normalized = value.trim().toLowerCase();
    if (type === 'extensions') normalized = normalized.replace(/^\./, '');
    if (!normalized || !Object.hasOwn(associations, type)) throw new Error('A content icon association needs a type and value');
    if (type === 'kinds' && !Object.hasOwn(associations.kinds, normalized)) throw new Error('Unknown content icon kind');
    return `${type}:${normalized}`;
  }
  private lookup(type: keyof typeof associations, value: string, dark: boolean): BundledIconName | undefined {
    const key = value.trim().toLowerCase(),override = this.overrides.get(`${type}:${key}`);
    if (override) return dark ? override.dark : override.light;
    const rules: Readonly<Record<string, BundledIconName>> = associations[type];
    return Object.hasOwn(rules, key) ? rules[key] : undefined;
  }
  resolve(input: ContentIconInput): BundledIconName {return resolveWith(input,(type,value,dark)=>this.lookup(type,value,dark))??'file';}
  /** Only trusted Host theme snapshots enter here. XML admission belongs to the importer. */
  useTheme(theme:IconThemePackage|null):void {
    this.theme=theme;this.artworkByGlyph.clear();
    if(!theme)return;
    const artwork=(glyph:string,svg:string):ContentIconArtwork=>({kind:'svg',id:`${theme.id}/${glyph}`,src:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,monochrome:svg.toLowerCase().includes('currentcolor')});
    for(const [glyph,variants] of Object.entries(theme.icons)){
      if(!variants)continue;
      const light=artwork(glyph,variants.light);
      this.artworkByGlyph.set(glyph,{light,dark:variants.dark?artwork(glyph,variants.dark):light});
    }
  }
  artwork(input:ContentIconInput):ContentIconArtwork {
    const glyph=this.theme&&resolveWith(input,(section,value)=>this.theme?.associations[section]?.[value.trim().toLowerCase()]);
    if(glyph){
      const variants=this.artworkByGlyph.get(glyph);if(variants)return input.dark?variants.dark:variants.light;
      const bundled=canonicalIconName(glyph);if(bundled)return {kind:'bundled',name:bundled};
    }
    return {kind:'bundled',name:this.resolve(input)};
  }
}
export const contentIcons = new ContentIconRegistry();
export function contentIcon(input: ContentIconInput): BundledIconName { return contentIcons.resolve(input); }
export type { BundledIconName } from './content-data.generated.js';
