/** Crop coordinates refer to the source. Output size is before clockwise rotation. */
export type RasterEdit = { x: number; y: number; width: number; height: number; outputWidth: number; outputHeight: number; rotation: number };
export const rasterLimits = { side: 8192, pixels: 16_777_216 } as const;

export function rasterEditPlan(sourceWidth: number, sourceHeight: number, edit: RasterEdit) {
  const dimensions = [sourceWidth, sourceHeight, edit.width, edit.height, edit.outputWidth, edit.outputHeight];
  if (dimensions.some(value => !Number.isInteger(value) || value <= 0 || value > rasterLimits.side) ||
      [edit.x, edit.y].some(value => !Number.isInteger(value) || value < 0) ||
      edit.x + edit.width > sourceWidth || edit.y + edit.height > sourceHeight ||
      sourceWidth * sourceHeight > rasterLimits.pixels || edit.outputWidth * edit.outputHeight > rasterLimits.pixels ||
      ![0, 90, 180, 270].includes(edit.rotation)) throw new Error('Invalid crop, rotation or output dimensions.');
  return { ...edit, canvasWidth: edit.rotation % 180 ? edit.outputHeight : edit.outputWidth,
    canvasHeight: edit.rotation % 180 ? edit.outputWidth : edit.outputHeight };
}
