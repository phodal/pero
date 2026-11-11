import { validatePageFrontmatter, validateProjectFrontmatter, fillPageFrontmatter, type PageFrontmatter, type ProjectFrontmatter } from 'myst-frontmatter';

/** Upstream page schema, including normalized contributors, affiliations and funding.
 * This is a derived projection, never a replacement for authored YAML metadata.
 * It does not merge project defaults, resolve resources or execute configuration.
 */
export type MystScholarlyMetadata = PageFrontmatter;
export interface MystMetadataDiagnostic {
  severity: 'warning' | 'error';
  code: 'frontmatter-validation' | 'frontmatter-date' | 'frontmatter-validator-error';
  property: string;
  message: string;
}
export interface MystMetadataValidation {
  normalized: MystScholarlyMetadata;
  diagnostics: MystMetadataDiagnostic[];
}

// Upstream's explicit calendar parsers are deterministic. Its final Date.parse
// fallback uses the host timezone (and accepts incomplete dates). Do not use it.
const calendarDate = /^(?:\d{4}(?:-\d{2})?(?:-\d{2})?(?:T.*)?|(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),)?\s*\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*(?:[^\s].*)?)$/;

/** Validate already JSON-portable frontmatter from the YAML boundary.
 * Uses myst-frontmatter 1.10.2 (upstream 50e82202324dc36f10bd04877d00016879da6f6e).
 * Raw metadata must remain alongside this projection: upstream omits invalid and
 * unknown fields, including custom namespaces. No network, clock, files, plugins,
 * template loading or project-level inheritance is involved.
 */
export function validateMystMetadata(metadata: Record<string, unknown>): MystMetadataValidation {
  return validateMetadata(metadata, validatePageFrontmatter);
}

export function validateMystProjectMetadata(metadata: Record<string, unknown>): { normalized: ProjectFrontmatter; diagnostics: MystMetadataDiagnostic[] } {
  return validateMetadata(metadata, validateProjectFrontmatter);
}

function validateMetadata<T extends PageFrontmatter>(metadata: Record<string, unknown>, validator: (input: unknown, options: Parameters<typeof validatePageFrontmatter>[1]) => T): { normalized: T; diagnostics: MystMetadataDiagnostic[] } {
  // The upstream DOI alias and contributor normalization can mutate nested input.
  const input = structuredClone(metadata);
  const diagnostics: MystMetadataDiagnostic[] = [];
  const messages: Parameters<typeof validatePageFrontmatter>[1]['messages'] = { errors: [], warnings: [] };
  if (input.date != null && (typeof input.date !== 'string' || !calendarDate.test(input.date))) {
    diagnostics.push({
      severity: 'error', code: 'frontmatter-date', property: 'frontmatter.date',
      message: 'Use an explicit ISO 8601 or RFC 2822 calendar date; timezone-dependent date parsing is disabled. The authored value is retained in raw metadata.',
    });
    delete input.date;
  }
  let normalized = {} as T;
  try {
    normalized = validator(input, { property: 'frontmatter', messages });
  } catch (error) {
    // Some malformed nested values (for example a null author) throw in upstream
    // rather than reporting validation errors. Keep the source usable and expose
    // failure, rather than labeling raw values as validated metadata.
    diagnostics.push({
      severity: 'error', code: 'frontmatter-validator-error', property: 'frontmatter',
      message: `Unable to normalize frontmatter: ${error instanceof Error ? error.message : 'upstream validation failed'}. Raw metadata is retained; the normalized projection is unavailable.`,
    });
  }
  for (const [severity, entries] of [['error', messages.errors], ['warning', messages.warnings]] as const) {
    for (const entry of entries ?? []) diagnostics.push({
      severity, code: 'frontmatter-validation', property: entry.property,
      message: `${entry.property}: ${entry.message}. Authored metadata is retained unchanged.`,
    });
  }
  // Remove undefined properties left by invalid fields. The projection must have
  // the same shape in memory and in a portable JSON bundle.
  return { normalized: JSON.parse(JSON.stringify(normalized)) as T, diagnostics };
}

/** Official contributor-aware inheritance. Never replace this with an object spread. */
export function inheritMystMetadata(page: PageFrontmatter, project: ProjectFrontmatter): MystMetadataValidation {
  const messages: Parameters<typeof fillPageFrontmatter>[2]['messages'] = { errors: [], warnings: [] };
  const diagnostics: MystMetadataDiagnostic[] = [];
  let normalized: PageFrontmatter = structuredClone(page);
  try {
    normalized = fillPageFrontmatter(structuredClone(page), structuredClone(project), { property: 'frontmatter', messages });
  } catch (error) {
    diagnostics.push({ severity: 'error', code: 'frontmatter-validator-error', property: 'frontmatter', message: `Unable to inherit project metadata: ${error instanceof Error ? error.message : 'upstream validation failed'}` });
  }
  for (const [severity, entries] of [['error', messages.errors], ['warning', messages.warnings]] as const) {
    for (const entry of entries ?? []) diagnostics.push({ severity, code: 'frontmatter-validation', property: entry.property, message: `${entry.property}: ${entry.message}` });
  }
  return { normalized: JSON.parse(JSON.stringify(normalized)) as PageFrontmatter, diagnostics };
}
