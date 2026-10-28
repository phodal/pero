/** Build output supplied by an App owner; contains no source or build commands. */
export class AppBundle {
  readonly schemaVersion = 1;
  readonly name: string;
  readonly files: readonly string[];

  private constructor(name: string, files: string[]) {
    this.name = name;
    this.files = Object.freeze([...files]);
    Object.freeze(this);
  }

  static parse(value: unknown): AppBundle {
    const v = value as { schemaVersion?: unknown; name?: unknown; files?: unknown };
    if (!v || typeof v !== 'object' || Array.isArray(v) ||
      Object.keys(v).some(key => !['schemaVersion', 'name', 'files'].includes(key)) ||
      v.schemaVersion !== 1 || typeof v.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.name) ||
      !Array.isArray(v.files) || !v.files.length || !v.files.includes('app.json') ||
      !v.files.every((path: unknown) => typeof path === 'string' && path.length > 0 &&
        !/[\\:\x00]/.test(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')) ||
      new Set(v.files).size !== v.files.length) throw new Error('Invalid AppBundle definition');
    // Each entry is a file, not an implicitly copied directory tree.
    return new AppBundle(v.name, v.files);
  }
}
