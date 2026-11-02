export declare const STRUCTURED_RESULT_LIMITS: Readonly<Record<'titleChars' | 'columns' | 'rows' | 'cellChars' | 'series' | 'pointsPerSeries' | 'labelChars' | 'provenanceLabelChars', number>>;
export declare const PROVENANCE_KINDS: readonly ['user-provided', 'calculated', 'sourced', 'illustrative'];
export declare const PROVENANCE_REF_TYPES: readonly ['artifact', 'evidence', 'run', 'url'];
export declare function validateStructuredResult(input: unknown): { ok: true; value: unknown } | { ok: false; errors: string[] };
export declare function truncateStructuredResult<T>(input: T): T;
