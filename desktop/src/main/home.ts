// The workbench home. Isolated profiles (tests and PERO_DESKTOP_DATA_DIR) stay
// in their own directory; a normal launch uses one directory under ~/.pero.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, copyFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type WorkbenchLocations = {
  isolated: boolean;
  settings: string;
  apps: string;
  python: string;
};

export function workbenchLocations(
  env: NodeJS.ProcessEnv,
  userData: string,
  home = join(homedir(), '.pero'),
): WorkbenchLocations {
  const isolated = Boolean(env.PERO_DESKTOP_DATA_DIR);
  return {
    isolated,
    settings: env.PERO_SETTINGS_PATH || (isolated
      ? join(userData, 'runtime-settings.json')
      : join(home, 'config', 'runtime-settings.json')),
    apps: env.PERO_APPS_ROOT || (isolated ? join(userData, 'apps') : join(home, 'apps')),
    python: join(home, 'environment', 'pero-default'),
  };
}

/** Move a previous Electron profile into the home once. A later launch keeps whichever side already exists. */
export function migrateLegacyWorkbench(userData: string, locations: WorkbenchLocations, home: string): void {
  if (locations.isolated || locations.apps !== join(home, 'apps')) return;
  moveIfAbsent(join(userData, 'apps'), locations.apps);
  moveIfAbsent(join(userData, 'app-data'), join(home, 'app-data'));
  const legacySettings = join(userData, 'runtime-settings.json');
  if (!existsSync(locations.settings) && existsSync(legacySettings)) {
    mkdirSync(dirname(locations.settings), { recursive: true });
    copyFileSync(legacySettings, locations.settings);
  }
}

/** Record the shared environment when the settings file has no default yet. */
export function assignDefaultPython(settingsPath: string, pythonHome: string): void {
  const value = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be an object');
  const current = value.app_python;
  const appPython = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
  if (typeof appPython.default === 'string' && appPython.default) return;
  value.app_python = { ...appPython, default: pythonHome };
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function prepareWorkbenchHome(env: NodeJS.ProcessEnv, userData: string): WorkbenchLocations {
  const home = join(homedir(), '.pero');
  const locations = workbenchLocations(env, userData, home);
  if (locations.isolated) return locations;
  try {
    migrateLegacyWorkbench(userData, locations, home);
    if (!env.PERO_APP_PYTHON && !env.PERO_SETTINGS_PATH && ensureSharedPython(locations.python)) {
      assignDefaultPython(locations.settings, locations.python);
    }
  } catch (error) {
    console.error(`Pero home was not prepared: ${error instanceof Error ? error.message : error}`);
  }
  return locations;
}

function moveIfAbsent(source: string, destination: string): void {
  if (!existsSync(source) || existsSync(destination)) return;
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(source, destination);
}

function ensureSharedPython(root: string): boolean {
  const python = join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) {
    mkdirSync(dirname(root), { recursive: true });
    const created = spawnSync(resolvePython(), ['-m', 'venv', root], { stdio: 'inherit' });
    if (created.status !== 0 || !existsSync(python)) {
      console.error('The shared Python environment could not be created.');
      return false;
    }
  }
  const config = readFileSync(join(root, 'pyvenv.cfg'), 'utf8');
  const isolated = config.split('\n')
    .filter(line => line.split('=')[0]?.trim().toLowerCase() === 'include-system-site-packages')
    .at(-1)?.split('=').slice(1).join('=').trim().toLowerCase() === 'false';
  if (!isolated) {
    console.error(`Python environment ${root} must set include-system-site-packages = false.`);
    return false;
  }
  const imports = () => spawnSync(python, ['-c', 'import pypdfium2, PIL.Image'], { stdio: 'ignore' }).status === 0;
  if (imports()) return true;
  const installed = spawnSync(python, ['-m', 'pip', 'install', 'pypdfium2==5.0.0', 'Pillow==12.0.0'], { stdio: 'inherit' });
  if (installed.status !== 0 || !imports()) {
    console.error('Paper Agent PDF packages were not installed into the shared Python environment.');
    return false;
  }
  return true;
}

function resolvePython(): string {
  const found = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  const executable = found.stdout?.trim();
  if (found.status === 0 && executable) return executable;
  return 'python3';
}
