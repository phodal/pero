import { associations, canonicalIconName, type BundledIconName } from './content-data.generated.js';

export type ContentIconKind = keyof typeof associations.kinds;
export type ContentIconInput = { kind?: ContentIconKind; language?: string; path?: string; app?: string; dark?: boolean };
export type ContentIconAssociation = { type: keyof typeof associations; value: string };
type ThemeIcon = { light: BundledIconName; dark: BundledIconName };

/** Associations can select bundled glyphs; they never supply SVG or a resource URL. */
export class ContentIconRegistry {
  private overrides = new Map<string, ThemeIcon>();
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
    const key = value.trim().toLowerCase();
    const override = this.overrides.get(`${type}:${key}`);
    if (override) return dark ? override.dark : override.light;
    const rules: Readonly<Record<string, BundledIconName>> = associations[type];
    return Object.hasOwn(rules, key) ? rules[key] : undefined;
  }
  resolve(input: ContentIconInput): BundledIconName {
    const dark = input.dark ?? false, kind = input.kind ?? 'file';
    if (kind === 'app' || input.app !== undefined) return this.lookup('apps', input.app ?? '', dark) ?? this.lookup('kinds', 'app', dark)!;
    if (input.language) {
      const icon = this.lookup('languages', input.language, dark);
      if (icon) return icon;
    }
    // A declared structured format is stronger evidence than a name suffix.
    if (!['file', 'text', 'code'].includes(kind)) return this.lookup('kinds', kind, dark) ?? 'file';
    const filename = (input.path ?? '').split(/[\\/]/).at(-1)!.toLowerCase();
    const exact = this.lookup('filenames', filename, dark);
    if (exact) return exact;
    for (let dot = filename.indexOf('.'); dot >= 0; dot = filename.indexOf('.', dot + 1)) {
      const icon = this.lookup('extensions', filename.slice(dot + 1), dark);
      if (icon) return icon;
    }
    return this.lookup('kinds', kind, dark) ?? 'file';
  }
}

export const contentIcons = new ContentIconRegistry();
export function contentIcon(input: ContentIconInput): BundledIconName { return contentIcons.resolve(input); }
export type { BundledIconName } from './content-data.generated.js';
