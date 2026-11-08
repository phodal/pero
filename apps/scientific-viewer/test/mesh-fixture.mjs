export function meshDocument() {
  return { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
}
export function glb(doc = meshDocument(), bin = new Uint8Array(doc.buffers[0].byteLength)) {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const jsonSize = Math.ceil(json.length / 4) * 4, binSize = Math.ceil(bin.length / 4) * 4;
  const bytes = new Uint8Array(28 + jsonSize + binSize), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonSize, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonSize); bytes.set(json, 20);
  view.setUint32(20 + jsonSize, binSize, true); view.setUint32(24 + jsonSize, 0x004e4942, true);
  bytes.set(bin, 28 + jsonSize); return bytes;
}

// A self-contained, valid 1×1 PNG fixture for the browser texture/CSP smoke test.
export function embeddedPngMesh() {
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64'));
  const doc = meshDocument(); doc.buffers[0].byteLength = 36 + png.length;
  doc.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: png.length });
  doc.images = [{ bufferView: 1, mimeType: 'image/png' }]; doc.textures = [{ source: 0 }];
  doc.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
  doc.meshes[0].primitives[0].material = 0;
  const bin = new Uint8Array(doc.buffers[0].byteLength);
  new Float32Array(bin.buffer, 0, 9).set([-1, -1, 0, 1, -1, 0, 0, 1, 0]); bin.set(png, 36);
  doc.accessors[0].min = [-1, -1, 0]; doc.accessors[0].max = [1, 1, 0];
  return glb(doc, bin);
}
