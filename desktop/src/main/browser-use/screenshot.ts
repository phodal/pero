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
