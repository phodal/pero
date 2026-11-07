// ACP uses pipes; console windows from adapter/CLI descendants are never its UI.
if (process.platform === 'win32') {
  const childProcess = require('node:child_process');
  const { syncBuiltinESMExports } = require('node:module');
  const spawn = childProcess.spawn;
  childProcess.spawn = (command, args, options) => {
    if (!Array.isArray(args)) {
      options = args ?? options;
      args = [];
    }
    return spawn(command, args, { ...options, windowsHide: true });
  };
  syncBuiltinESMExports();
}
