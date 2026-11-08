import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMesh, MESH_LIMITS } from '../ui-src/mesh-asset.ts';

import { meshDocument as document, glb, embeddedPngMesh } from './mesh-fixture.mjs';

test('admitted mesh preserves bytes and counts instances without changing geometry', () => {
  const doc = document(); doc.nodes.push({ mesh: 0, translation: [10, 0, 0] }); doc.scenes[0].nodes.push(1);
  doc.materials = [{ extensions: { KHR_materials_transmission: { transmissionFactor: 0.2 }, KHR_materials_ior: { ior: 1.5 }, KHR_materials_specular: {} } }];
  doc.extensionsUsed = ['KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_specular'];
  const bytes = glb(doc), original = bytes.slice(), asset = validateMesh(bytes);
  assert.equal(asset.bytes, bytes); assert.deepEqual(bytes, original);
  assert.deepEqual(asset.stats, { triangles: 2, nodes: 2, materials: 1, decodedBytes: 36, texturePixels: 0 });
  const padded = new Uint8Array(bytes.length + 8); padded.set(bytes, 4);
  assert.deepEqual(validateMesh(padded.subarray(4, -4)).stats, asset.stats);
});

test('GLB admission rejects corrupt headers and bounded chunks', () => {
  for (const bytes of [new Uint8Array(), glb().subarray(0, 19), new Uint8Array(MESH_LIMITS.bytes + 1), glb().subarray(0, -1)]) assert.throws(() => validateMesh(bytes), /Invalid mesh/);
  for (const [offset, value] of [[0, 0], [4, 1], [8, 20], [12, 0xffffffff], [16, 0x004e4942]]) {
    const bytes = glb(); new DataView(bytes.buffer).setUint32(offset, value, true);
    assert.throws(() => validateMesh(bytes), /Invalid mesh/);
  }
  const bytes = glb(); bytes[20] = 0xff; assert.throws(() => validateMesh(bytes), /malformed JSON/);
});

test('mesh subset rejects escaped resources, unsafe geometry and invalid references', () => {
  const cases = [
    [d => { d.buffers[0].uri = 'https://example.com/mesh.bin'; }, /URIs/],
    [d => { d.images = [{ uri: 'data:image/png;base64,AA==' }]; }, /URIs/],
    [d => { d.extensionsRequired = ['KHR_draco_mesh_compression']; }, /unsupported/],
    [d => { d.meshes[0].primitives[0].extensions = { EXT_meshopt_compression: {} }; }, /unsupported/],
    [d => { d.extras = { extensions: { EXT_unknown: { source: 0 } } }; }, /unsupported/],
    [d => { d.bufferViews[0].byteOffset = 4; }, /bufferView length/],
    [d => { d.accessors[0].count = 4; }, /accessor range/],
    [d => { d.accessors[0].bufferView = 9; }, /bufferView/],
    [d => { d.accessors[0].sparse = {}; }, /sparse/],
    [d => { d.meshes[0].primitives[0].attributes.POSITION = 5; }, /POSITION/],
    [d => { d.meshes[0].primitives[0].mode = 1; }, /triangle/],
    [d => { d.meshes[0].primitives[0].material = 0; }, /material/],
    [d => { d.textures = [{ source: 0 }]; }, /texture source/],
    [d => { d.materials = [{ normalTexture: { index: 0 } }]; }, /material texture/],
    [d => { d.animations = []; }, /animations/],
    [d => { d.nodes[0].mesh = 1; }, /node mesh/],
    [d => { d.nodes[0].children = [0]; }, /cyclic/],
    [d => { d.nodes.push({ children: [0] }, { children: [0] }); }, /multi-parent/],
    [d => { d.nodes[0].children = [1]; d.nodes.push({}); d.scenes[0].nodes = [1]; }, /parentless/],
    [d => { d.scenes[0].nodes = [0, 0]; }, /scene nodes|unique/],
    [d => { d.nodes[0].translation = [0, 0]; }, /vector/],
    [d => { d.nodes = Array.from({ length: 1025 }, () => ({})); }, /nodes count/],
    [d => { d.materials = Array.from({ length: 129 }, () => ({})); }, /materials count/],
    [d => { d.extras = {}; let obj = d.extras; for (let i = 0; i < 35; i++) obj = obj.next = {}; }, /complexity/],
  ];
  for (const [change, reason] of cases) { const doc = document(); change(doc); assert.throws(() => validateMesh(glb(doc)), reason); }
  const bin = new Uint8Array(36); new DataView(bin.buffer).setFloat32(0, NaN, true);
  assert.throws(() => validateMesh(glb(document(), bin)), /non-finite geometry/);
});

test('index values and repeated mesh instances are budgeted', () => {
  const doc = document(); doc.buffers[0].byteLength = 40;
  doc.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 3 });
  doc.accessors.push({ bufferView: 1, componentType: 5121, count: 3, type: 'SCALAR' });
  doc.meshes[0].primitives[0].indices = 1;
  const bin = new Uint8Array(40); bin.set([0, 1, 2], 36);
  assert.equal(validateMesh(glb(doc, bin)).stats.triangles, 1);
  bin[38] = 3; assert.throws(() => validateMesh(glb(doc, bin)), /index exceeds/);
  const instanced = document();
  instanced.meshes[0].primitives = Array.from({ length: 256 }, () => ({ attributes: { POSITION: 0 } }));
  instanced.nodes = Array.from({ length: 1024 }, () => ({ mesh: 0 }));
  instanced.scenes[0].nodes = Array.from({ length: 1024 }, (_, i) => i);
  assert.throws(() => validateMesh(glb(instanced)), /triangle budget/);
});

test('decoded accessor and texture budgets are independent of compressed file size', () => {
  const doc = document(); doc.buffers[0].byteLength = 120_000; doc.bufferViews[0].byteLength = 120_000;
  doc.accessors = Array.from({ length: 600 }, () => ({ bufferView: 0, componentType: 5126, count: 9999, type: 'VEC3' }));
  assert.throws(() => validateMesh(glb(doc)), /decoded resource budget/);
  const imageDoc = document(); imageDoc.buffers[0].byteLength = 72;
  imageDoc.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 33 });
  imageDoc.images = [{ bufferView: 1, mimeType: 'image/png' }];
  const bin = new Uint8Array(72), view = new DataView(bin.buffer);
  for (const [offset, value] of [[36, 0x89504e47], [40, 0x0d0a1a0a], [44, 13], [48, 0x49484452], [52, 4096], [56, 4096]]) view.setUint32(offset, value);
  assert.throws(() => validateMesh(glb(imageDoc, bin)), /resource budget/);
  view.setUint32(52, 8192); assert.throws(() => validateMesh(glb(imageDoc, bin)), /image width/);
});

test('bundled Polyfork research models remain admissible with their authored triangle counts', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const [name, triangles, nodes, materials] of [
    ['optics-table-66db15', 574, 5, 1], ['research-microscope-77ce04', 650, 8, 1], ['sample-tube-rack-3a32bd', 638, 7, 3],
  ]) {
    const bytes = await readFile(new URL(`../assets/research-lab/${name}.glb`, import.meta.url));
    const asset = validateMesh(bytes);
    assert.equal(asset.stats.triangles, triangles, name); assert.equal(asset.stats.nodes, nodes, name);
    assert.equal(asset.stats.materials, materials, name); assert.equal(asset.stats.texturePixels, 0, name);
  }
});

test('interleaved accessor admission matches Three complete-record allocation', async () => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const doc = document();
  doc.buffers[0].byteLength = 44; doc.bufferViews[0].byteLength = 44; doc.bufferViews[0].byteStride = 16;
  doc.accessors[0].min = [0, 0, 0]; doc.accessors[0].max = [0, 0, 0];
  const truncated = glb(doc);
  await assert.rejects(new GLTFLoader().parseAsync(truncated.buffer, ''), /Invalid typed array length/);
  assert.throws(() => validateMesh(truncated), /complete stride records/);
  doc.buffers[0].byteLength = 48; doc.bufferViews[0].byteLength = 48;
  const complete = validateMesh(glb(doc));
  assert.equal(complete.stats.decodedBytes, 48);
  const loaded = await new GLTFLoader().parseAsync(complete.bytes.buffer, '');
  const position = loaded.scene.children[0].geometry.attributes.position;
  assert.equal(position.count, 3); assert.equal(position.data.stride, 4);
  loaded.scene.children[0].geometry.dispose(); loaded.scene.children[0].material.dispose();
});

test('embedded PNG texture is admitted and decoded plus GPU budgets are counted', () => {
  const asset = validateMesh(embeddedPngMesh());
  assert.equal(asset.stats.texturePixels, 1); assert.equal(asset.stats.materials, 1);
  assert.equal(asset.stats.decodedBytes, 36 + 4 + 6);
});
