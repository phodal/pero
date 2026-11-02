export interface ThemeInfo { readonly id: string; readonly label: string; readonly colorScheme: "light" | "dark" }
export declare const THEMES: readonly ThemeInfo[];
export declare const BASE_THEME: string;
export declare function getTheme(id: string): ThemeInfo | undefined;
export declare function currentThemeId(doc?: Document): string;
export declare function currentColorScheme(doc?: Document): "light" | "dark";
export declare function applyTheme(id: string | null, doc?: Document): string;
export declare function subscribeTheme(callback: (id: string) => void, doc?: Document): () => void;
export declare function tokenColor(name: string, fallback?: string, element?: Element): string;
export interface StyleInfo { readonly id: string; readonly label: string; readonly description: string }
export declare const STYLES: readonly StyleInfo[];
export declare const BASE_STYLE: string;
export declare function getStyle(id: string): StyleInfo | undefined;
export declare function currentStyleId(doc?: Document): string;
export declare function applyStyle(id: string | null, doc?: Document): string;
export declare function subscribeStyle(callback: (id: string) => void, doc?: Document): () => void;
export declare function applyDevStyle(doc?: Document): string | null;
export declare function tokenValue(name: string, fallback?: string, element?: Element): string;
