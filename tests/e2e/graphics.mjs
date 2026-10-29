// Probe the CI graphics adapter without rebuilding Rust or packaging a product.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'pero-graphics-'));
writeFileSync(join(scratch, 'main.cjs'), `
const {app,BrowserWindow}=require('electron');
app.whenReady().then(()=>{
 const window=new BrowserWindow({webPreferences:{sandbox:true,contextIsolation:true}});
 window.loadURL('data:text/html,<canvas id="probe" width="200" height="100"></canvas>');
});
app.on('window-all-closed',()=>app.quit());
`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ requiresNativeWindow: true, args: [join(scratch, 'main.cjs'), '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'], env });
  const page = await app.firstWindow();
  const result = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    if (!gl) return { webgl2: false };
    gl.clearColor(0.2, 0.4, 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { webgl2: true, pixel: [...pixel], renderer: gl.getParameter(gl.RENDERER) };
  });
  console.log(JSON.stringify({ platform: process.platform, ...result }));
  expect(result.webgl2).toBe(true);
  expect(result.pixel).toEqual([51, 102, 153, 255]);
} finally {
  if (app) await app.close();
  rmSync(scratch, { recursive: true, force: true });
}
