/** Deterministic synthetic files, never observed scientific data. */
export function richArtifactFiles(revision?: number): Array<{
  name: string; title: string; mediaType: string; data: Buffer;
}>;
