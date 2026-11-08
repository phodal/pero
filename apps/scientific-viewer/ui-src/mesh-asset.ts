/** The admitted subset is static, self-contained GLB 2: triangles and embedded PNG/JPEG. */
export type MeshAsset = Readonly<{
  bytes: Uint8Array;
  stats: Readonly<{ triangles: number; nodes: number; materials: number; decodedBytes: number; texturePixels: number }>;
}>;

export const MESH_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, jsonBytes: 1024 * 1024,
  triangles: 250_000, nodes: 1024, materials: 128, decodedBytes: 64 * 1024 * 1024,
  texturePixels: 8 * 1024 * 1024 });

type ObjectValue = Record<string, any>;
const allowedExtensions = new Set(['KHR_materials_unlit', 'KHR_materials_transmission',
  'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_clearcoat']);
const fail = (message: string): never => { throw new Error(`Invalid mesh: ${message}`); };
const object = (value: unknown, label: string): ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : fail(`${label} must be an object`);
const integer = (value: unknown, max: number, label: string, min = 0): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : fail(`${label} is out of bounds`);
const list = (value: unknown, max: number, label: string): ObjectValue[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) fail(`${label} count exceeds limit`);
  return (value as unknown[]).map(item => object(item, label));
};
const ref = (value: unknown, values: unknown[], label: string): number => integer(value, values.length - 1, label);
const vector = (value: unknown, size: number, label: string) => {
  if (!Array.isArray(value) || value.length !== size || !value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e12)) fail(`${label} must be a finite vector`);
};

/** Validates once before GLTFLoader can create resources; does not rewrite geometry. */
export function validateMesh(bytes: Uint8Array): MeshAsset {
  if (bytes.byteLength < 20 || bytes.byteLength > MESH_LIMITS.bytes) fail('GLB size exceeds limit or header is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) fail('GLB header/version/length');
  let offset = 12;
  const chunks: { type: number; start: number; length: number }[] = [];
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) fail('truncated chunk header');
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > bytes.byteLength || chunks.length >= 2) fail('invalid chunk length/count');
    chunks.push({ type, start: offset + 8, length }); offset += 8 + length;
  }
  if (chunks[0]?.type !== 0x4e4f534a || chunks[0].length > MESH_LIMITS.jsonBytes || (chunks[1] && chunks[1].type !== 0x004e4942)) fail('expected JSON then BIN chunks');
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(chunks[0].start, chunks[0].start + chunks[0].length))); }
  catch { fail('malformed JSON'); }
  const gltf = object(parsed, 'document');
  // Iterative traversal caps nesting and JSON complexity, including otherwise ignored extras.
  const pending = [{ value: gltf, depth: 0 }]; let entries = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++entries > 100_000 || depth > 32) fail('JSON complexity limit');
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uri') fail('external and data URIs are not supported');
      if (key === 'extensions') {
        for (const name of Object.keys(object(child, 'extensions'))) if (!allowedExtensions.has(name)) fail(`unsupported extension ${name}`);
      }
      if (typeof child === 'number' && !Number.isFinite(child)) fail('non-finite number');
      if (child !== null && typeof child === 'object') pending.push({ value: child, depth: depth + 1 });
    }
  }
  if (object(gltf.asset, 'asset').version !== '2.0' || (gltf.asset.minVersion && gltf.asset.minVersion !== '2.0')) fail('unsupported asset version');
  for (const key of ['extensionsRequired', 'extensionsUsed']) {
    if (gltf[key] !== undefined && (!Array.isArray(gltf[key]) || gltf[key].some((name: unknown) => typeof name !== 'string' || !allowedExtensions.has(name)))) fail(`unsupported ${key}`);
  }
  for (const key of ['animations', 'skins', 'cameras']) if (gltf[key] !== undefined) fail(`${key} are not supported`);
  const buffers = list(gltf.buffers, 1, 'buffers'), views = list(gltf.bufferViews, 4096, 'bufferViews');
  const accessors = list(gltf.accessors, 4096, 'accessors'), meshes = list(gltf.meshes, 1024, 'meshes');
  const nodes = list(gltf.nodes, MESH_LIMITS.nodes, 'nodes'), materials = list(gltf.materials, MESH_LIMITS.materials, 'materials');
  const images = list(gltf.images, 128, 'images'), textures = list(gltf.textures, 128, 'textures');
  const samplers = list(gltf.samplers, 128, 'samplers'), scenes = list(gltf.scenes, 32, 'scenes');
  if (buffers.length !== 1 || !chunks[1]) fail('one embedded binary buffer is required');
  const bufferLength = integer(buffers[0].byteLength, chunks[1].length, 'buffer length', 1);
  if (chunks[1].length - bufferLength > 3) fail('invalid BIN padding');
  for (const bv of views) {
    if (bv.buffer !== 0) fail('bufferView buffer reference');
    const start = integer(bv.byteOffset ?? 0, bufferLength, 'bufferView offset');
    integer(bv.byteLength, bufferLength - start, 'bufferView length', 1);
    if (bv.byteStride !== undefined) {
      integer(bv.byteStride, 252, 'bufferView stride', 4);
      if (bv.byteStride % 4) fail('unaligned bufferView stride');
    }
    if (bv.target !== undefined && ![34962, 34963].includes(bv.target)) fail('invalid bufferView target');
  }
  let decodedBytes = 0, texturePixels = 0;
  const widths: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const sizes: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  for (const acc of accessors) {
    if (acc.sparse !== undefined) fail('sparse accessors are not supported');
    const bv = views[ref(acc.bufferView, views, 'accessor bufferView')];
    const width = widths[acc.componentType], size = sizes[acc.type];
    if (!width || !size) fail('unsupported accessor component/type');
    const count = integer(acc.count, 1_000_000, 'accessor count', 1);
    const start = integer(acc.byteOffset ?? 0, bv.byteLength, 'accessor offset');
    const stride = bv.byteStride ?? width * size;
    if (start % width || ((bv.byteOffset ?? 0) + start) % width || stride < width * size || stride % width || start + (count - 1) * stride + width * size > bv.byteLength) fail('accessor range/alignment');
    // Three allocates complete interleaved records, including the final record's padding.
    // A range containing only the last attribute's bytes is valid glTF but not our loader subset.
    if (stride !== width * size && (start % stride + width * size > stride || Math.floor(start / stride) * stride + count * stride > bv.byteLength)) fail('interleaved accessor requires complete stride records');
    if (acc.normalized !== undefined && (typeof acc.normalized !== 'boolean' || (acc.normalized && [5125, 5126].includes(acc.componentType)))) fail('invalid accessor normalization');
    for (const key of ['min', 'max']) if (acc[key] !== undefined) vector(acc[key], size, `accessor ${key}`);
    decodedBytes += count * Math.max(stride, size * 4);
    if (decodedBytes > MESH_LIMITS.decodedBytes) fail('decoded resource budget exceeded');
    // Reject non-finite geometry before it reaches bounds/camera calculations.
    if (acc.componentType === 5126) for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) {
      if (!Number.isFinite(view.getFloat32(chunks[1].start + (bv.byteOffset ?? 0) + start + i * stride + c * width, true))) fail('non-finite geometry');
    }
  }
  const imagePixels: number[] = [];
  for (const image of images) {
    const bv = views[ref(image.bufferView, views, 'image bufferView')];
    const data = bytes.subarray(chunks[1].start + (bv.byteOffset ?? 0), chunks[1].start + (bv.byteOffset ?? 0) + bv.byteLength);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let width = 0, height = 0;
    if (image.mimeType === 'image/png') {
      if (data.length < 33 || dv.getUint32(0) !== 0x89504e47 || dv.getUint32(4) !== 0x0d0a1a0a || dv.getUint32(8) !== 13 || dv.getUint32(12) !== 0x49484452) fail('invalid PNG header');
      width = dv.getUint32(16); height = dv.getUint32(20);
    } else if (image.mimeType === 'image/jpeg') {
      if (data.length < 4 || dv.getUint16(0) !== 0xffd8) fail('invalid JPEG header');
      let pos = 2;
      while (pos + 4 <= data.length) {
        if (data[pos++] !== 255) fail('invalid JPEG marker');
        while (data[pos] === 255) pos++;
        const marker = data[pos++];
        if (marker === 0xda || marker === 0xd9) break;
        if (pos + 2 > data.length) fail('truncated JPEG');
        const length = dv.getUint16(pos);
        if (length < 2 || pos + length > data.length) fail('invalid JPEG segment');
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
          if (length < 8) fail('invalid JPEG frame');
          height = dv.getUint16(pos + 3); width = dv.getUint16(pos + 5); break;
        }
        pos += length;
      }
    } else fail('only embedded PNG/JPEG images are supported');
    integer(width, 4096, 'image width', 1); integer(height, 4096, 'image height', 1);
    texturePixels += width * height;
    imagePixels.push(width * height);
    decodedBytes += width * height * 4;
  }
  for (const texture of textures) {
    const source = ref(texture.source, images, 'texture source');
    decodedBytes += Math.ceil(imagePixels[source] * 4 * 4 / 3);
    if (texture.sampler !== undefined) ref(texture.sampler, samplers, 'texture sampler');
  }
  for (const sampler of samplers) {
    for (const [key, choices] of Object.entries({ magFilter: [9728, 9729], minFilter: [9728, 9729, 9984, 9985, 9986, 9987], wrapS: [33071, 33648, 10497], wrapT: [33071, 33648, 10497] })) {
      if (sampler[key] !== undefined && !choices.includes(sampler[key])) fail('unsupported texture sampler');
    }
  }
  // Every textureInfo, including material extensions, must point at an admitted texture.
  for (const material of materials) {
    const queue = [material];
    while (queue.length) for (const [key, value] of Object.entries(queue.pop()!)) {
      if (key.endsWith('Texture')) {
        const info = object(value, 'texture info'); ref(info.index, textures, 'material texture');
        if (info.texCoord !== undefined) integer(info.texCoord, 1, 'texture coordinate');
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  let storedTriangles = 0;
  const meshTriangles = meshes.map(mesh => {
    if (mesh.weights !== undefined) fail('morph targets are not supported');
    const primitives = list(mesh.primitives, 256, 'primitives');
    if (!primitives.length) fail('mesh needs primitives');
    return primitives.reduce((total, primitive) => {
      if ((primitive.mode ?? 4) !== 4 || primitive.targets !== undefined) fail('only static triangle primitives are supported');
      const attributes = object(primitive.attributes, 'attributes');
      const position = accessors[ref(attributes.POSITION, accessors, 'POSITION')];
      if (position.type !== 'VEC3' || position.componentType !== 5126 || position.normalized) fail('POSITION must be float VEC3');
      for (const [name, index] of Object.entries(attributes)) {
        if (!['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'].includes(name)) fail(`unsupported attribute ${name}`);
        const acc = accessors[ref(index, accessors, name)];
        const expected = name.startsWith('TEXCOORD') ? ['VEC2'] : name === 'TANGENT' ? ['VEC4'] : name === 'COLOR_0' ? ['VEC3', 'VEC4'] : ['VEC3'];
        if (acc.count !== position.count || !expected.includes(acc.type)) fail('attribute shape/count mismatch');
      }
      let count = position.count;
      if (primitive.indices !== undefined) {
        const acc = accessors[ref(primitive.indices, accessors, 'indices')];
        if (acc.type !== 'SCALAR' || ![5121, 5123, 5125].includes(acc.componentType) || acc.normalized) fail('invalid index accessor');
        if (storedTriangles + acc.count / 3 > MESH_LIMITS.triangles) fail('triangle budget exceeded');
        const bv = views[acc.bufferView], width = widths[acc.componentType];
        if (bv.byteStride !== undefined) fail('indices cannot be interleaved');
        for (let i = 0; i < acc.count; i++) {
          const pos = chunks[1].start + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * width;
          const index = width === 1 ? view.getUint8(pos) : width === 2 ? view.getUint16(pos, true) : view.getUint32(pos, true);
          if (index >= position.count) fail('index exceeds vertex count');
        }
        count = acc.count;
      }
      if (primitive.material !== undefined) ref(primitive.material, materials, 'primitive material');
      if (count % 3) fail('triangle count is not divisible by three');
      storedTriangles += count / 3;
      if (storedTriangles > MESH_LIMITS.triangles) fail('triangle budget exceeded');
      return total + count / 3;
    }, 0);
  });
  const parents = new Set<number>(); let triangles = 0;
  for (const node of nodes) {
    for (const key of ['skin', 'camera', 'weights']) if (node[key] !== undefined) fail(`node ${key} is not supported`);
    for (const [key, size] of [['matrix', 16], ['translation', 3], ['rotation', 4], ['scale', 3]] as const) if (node[key] !== undefined) vector(node[key], size, key);
    if (node.matrix !== undefined && ['translation', 'rotation', 'scale'].some(key => node[key] !== undefined)) fail('matrix and TRS cannot coexist');
    if (node.mesh !== undefined) triangles += meshTriangles[ref(node.mesh, meshes, 'node mesh')];
    if (node.children !== undefined && !Array.isArray(node.children)) fail('node children must be an array');
    for (const child of node.children ?? []) {
      const index = ref(child, nodes, 'child node');
      if (parents.has(index)) fail('multi-parent node graph');
      parents.add(index);
    }
  }
  const visited = new Set<number>(), visiting = new Set<number>();
  const visit = (index: number) => {
    if (visiting.has(index)) fail('cyclic node graph');
    if (visited.has(index)) return;
    visiting.add(index);
    for (const child of nodes[index].children ?? []) visit(child);
    visiting.delete(index); visited.add(index);
  };
  nodes.forEach((_, index) => visit(index));
  for (const scene of scenes) {
    if (!Array.isArray(scene.nodes) || scene.nodes.length > nodes.length) fail('invalid scene nodes');
    const roots = new Set<number>();
    for (const root of scene.nodes) {
      ref(root, nodes, 'scene node');
      if (parents.has(root) || roots.has(root)) fail('scene root must be unique and parentless');
      roots.add(root);
    }
  }
  if (!scenes.length || !nodes.length || !meshes.length) fail('mesh scene is required');
  if (gltf.scene !== undefined) ref(gltf.scene, scenes, 'default scene');
  // Count all instances, even in non-default scenes, plus uninstantiated geometry.
  const uniqueTriangles = meshTriangles.reduce((a, b) => a + b, 0);
  if (Math.max(triangles, uniqueTriangles) > MESH_LIMITS.triangles) fail('triangle budget exceeded');
  if (texturePixels > MESH_LIMITS.texturePixels || decodedBytes > MESH_LIMITS.decodedBytes) fail('decoded resource budget exceeded');
  return Object.freeze({ bytes, stats: Object.freeze({ triangles, nodes: nodes.length, materials: materials.length, decodedBytes, texturePixels }) });
}
