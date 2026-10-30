// Native macOS AX input; renderer state is an independent, read-only effect oracle.
const { app, BrowserWindow } = require('electron');
const { writeFileSync, renameSync } = require('node:fs');
const output = process.argv[2];
app.commandLine.appendSwitch('force-renderer-accessibility');
app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  const window = new BrowserWindow({ title: 'Pero Electron Fixture', width: 550, height: 300, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<title>Pero Electron Fixture</title><button onclick="count++;document.querySelector(\'output\').textContent=count">Framework increment</button><input aria-label="Framework text"><output>0</output><script>var count=0</script>'));
  window.showInactive();
  const timer = setInterval(async () => {
    if (window.isDestroyed()) return;
    const effects = await window.webContents.executeJavaScript('({count:Number(document.querySelector("output").textContent),text:document.querySelector("input").value})');
    writeFileSync(output + '.tmp', JSON.stringify({ ...effects, pid: process.pid })); renameSync(output + '.tmp', output);
  }, 80);
  window.on('closed', () => { clearInterval(timer); app.quit(); });
});
