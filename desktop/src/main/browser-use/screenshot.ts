type ChromiumScreenshot = {
  (method: 'Page.getLayoutMetrics'): Promise<{ cssContentSize: { x: number; y: number; width: number; height: number } }>;
  (method: 'Page.captureScreenshot', params: object): Promise<{ data: string }>;
};

export async function captureChromiumDocument(send: ChromiumScreenshot) {
  const { cssContentSize: { x, y, width, height } } = await send('Page.getLayoutMetrics');
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1 ||
      Math.max(width, height) > 16384 || width * height > 16_000_000)
    throw new Error('The page is empty or too large for a full-page screenshot. Capture the viewport instead.');
  return send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: true,
    clip: { x, y, width: Math.ceil(width), height: Math.ceil(height), scale: 1 },
  });
}

// Kept self-contained so Electron can also run it in an isolated Chromium
// world. Chromium converts the capture's display profile to sRGB on the canvas.
export async function rasterScreenshot(base64: string, clip?: { x: number; y: number; width: number; height: number }) {
  const input = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([input], { type: 'image/png' }));
  try {
    const { x, y, width, height } = clip ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!context) throw new Error('Chromium could not prepare the screenshot raster.');
    context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 16384)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    return { base64: btoa(binary), width, height };
  } finally {
    bitmap.close();
  }
}
