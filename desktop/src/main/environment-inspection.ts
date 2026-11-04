/** Transport-only parsing. Method scope and software matching belong to Rust. */
export function environmentInspectionInput(value: unknown): { target: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a scientific method');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || typeof input.target !== 'string' || input.target.length > 128)
    throw new Error('Expected only a scientific method');
  return { target: input.target };
}
