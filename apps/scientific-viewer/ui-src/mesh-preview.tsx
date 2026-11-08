import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '@pero/app-sdk';
import { Button, Disclosure, Feedback } from '@pero/app-sdk/ui';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PreviewSource } from './preview-source';
import type { MeshProvenance } from './files';
import { validateMesh, type MeshAsset } from './mesh-asset';
import './mesh-preview.css';

/** Own every GPU resource, including scenes not chosen as the default. */
function disposeScenes(scenes: THREE.Group[]) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  for (const scene of scenes) scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const texture of textures) { texture.dispose(); if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) texture.source.data.close(); }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

export function MeshPreview({ source, provenance }: { source: PreviewSource; provenance?: MeshProvenance }) {
  const { dark, locale } = useAppContext(), zh = locale === 'zh-CN';
  const viewport = useRef<HTMLDivElement>(null), actions = useRef<{ fit(): void; zoom(factor: number): void; orbit(x: number, y: number): void; render(): void } | null>(null);
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(''), [ready, setReady] = useState(false);
  const [details, setDetails] = useState<{ stats: MeshAsset['stats']; dimensions: string } | null>(null);
  const [downloading, setDownloading] = useState(false), [downloadError, setDownloadError] = useState('');
  // A theme change only changes the surrounding surface, not the imported model or camera.
  const background = useRef<THREE.Scene | null>(null);
  useEffect(() => { if (background.current) { background.current.background = new THREE.Color(dark ? '#20252b' : '#f1f5f7'); actions.current?.render(); } }, [dark]);
  useEffect(() => {
    const host = viewport.current!;
    let cancelled = false, renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined, scenes: THREE.Group[] = [], frame = 0;
    setError(''); setReady(false); setDetails(null); actions.current = null;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(dark ? '#20252b' : '#f1f5f7'); background.current = scene;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    const render = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (!cancelled && renderer && !renderer.getContext().isContextLost()) renderer.render(scene, camera); }); };
    const lost = (event: Event) => { event.preventDefault(); setReady(false); setError(zh ? '3D 显示上下文已丢失。可重试，原文件未改变。' : 'The 3D display context was lost. Retry; the original file is unchanged.'); };
    async function load() {
      const mesh = validateMesh(source.bytes);
      // Input is self-contained. Even a loader regression must not fetch remote resources.
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(url => { if (url.startsWith('blob:')) return url; throw new Error('External mesh resources are not allowed'); });
      let textureFailed = false;
      manager.onError = url => { textureFailed = true; if (url.startsWith('blob:')) URL.revokeObjectURL(url); };
      const loader = new GLTFLoader(manager);
      // TextureLoader uses img-src blob: already allowed by both shells.
      // ImageBitmapLoader would fetch blobs under connect-src, which stays 'self'.
      loader.register(parser => ({ name: 'PERO_embedded_images', loadTexture: index =>
        parser.loadTextureImage(index, parser.json.textures[index].source, new THREE.TextureLoader(manager)) }));
      const gltf = await loader.parseAsync(new Uint8Array(mesh.bytes).buffer, '');
      if (textureFailed) { disposeScenes(gltf.scenes); throw new Error('An embedded texture could not be decoded; the model was not displayed'); }
      scenes = gltf.scenes;
      if (cancelled) { disposeScenes(scenes); scenes = []; return; }
      const bounds = new THREE.Box3().setFromObject(gltf.scene), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      if (bounds.isEmpty() || ![...size.toArray(), ...center.toArray()].every(Number.isFinite) || size.length() <= 0) throw new Error('The GLB has no finite visible geometry');
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-label', zh ? `${source.name} 3D 示意模型` : `${source.name} 3D illustration`);
      renderer.domElement.setAttribute('role', 'img'); renderer.domElement.tabIndex = 0;
      renderer.domElement.addEventListener('webglcontextlost', lost);
      host.append(renderer.domElement);
      scene.add(gltf.scene, new THREE.HemisphereLight(0xffffff, 0x617080, 2.5));
      const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 5, 4); scene.add(light);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false; controls.autoRotate = false; controls.target.copy(center);
      controls.addEventListener('change', render);
      const radius = size.length() / 2;
      const fit = () => {
        const angle = Math.min(camera.fov * Math.PI / 180, 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
        const distance = radius / Math.sin(angle / 2) * 1.15;
        camera.near = Math.max(radius / 1000, 0.000001); camera.far = distance + radius * 100;
        camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance));
        camera.updateProjectionMatrix(); controls!.target.copy(center);
        controls!.minDistance = radius * 0.1; controls!.maxDistance = radius * 40;
        controls!.update(); render();
      };
      actions.current = { fit, render, orbit: (x, y) => { const offset = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls!.target)); offset.theta += x; offset.phi += y; offset.makeSafe(); camera.position.copy(controls!.target).add(new THREE.Vector3().setFromSpherical(offset)); controls!.update(); render(); }, zoom: factor => { camera.position.sub(controls!.target).multiplyScalar(factor).add(controls!.target); controls!.update(); render(); } };
      const resize = () => { const { width, height } = host.getBoundingClientRect(); if (!width || !height) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer!.setSize(width, height); render(); };
      observer = new ResizeObserver(resize); observer.observe(host); resize(); fit();
      setDetails({ stats: mesh.stats, dimensions: size.toArray().map(value => Number(value.toPrecision(4)).toString()).join(' × ') });
      setReady(true);
    }
    void load().catch(reason => { if (!cancelled) { disposeScenes(scenes); scenes = []; setError(String(reason.message ?? reason)); } });
    return () => {
      cancelled = true; cancelAnimationFrame(frame); observer?.disconnect(); controls?.dispose(); actions.current = null; background.current = null;
      disposeScenes(scenes);
      if (renderer) { renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }
    };
  }, [source.id, source.bytes, attempt]);
  const download = async () => {
    setDownloading(true); setDownloadError('');
    try {
      let bytes: Uint8Array = source.bytes, name = source.name, type = 'model/gltf-binary';
      if (provenance) {
        const { zipSync, strToU8 } = await import('fflate');
        const credit = `${provenance.attribution}\nSource: ${provenance.sourceUrl}\nLicense: CC BY 4.0 (${provenance.licenseUrl})\nChanges: ${provenance.modifications}\nSHA-256: ${source.sha256}\nIllustration only. Dimensions and physical properties have not been verified.\n`;
        bytes = zipSync({ [source.name]: source.bytes, 'ATTRIBUTION.txt': strToU8(credit) }); name = `${source.name.replace(/\.glb$/i, '')}-with-attribution.zip`; type = 'application/zip';
      }
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) { setDownloadError(String(reason)); } finally { setDownloading(false); }
  };
  return <section className="mesh-preview" aria-label={zh ? '3D 模型预览' : '3D model preview'}>
    <nav className="mesh-toolbar" aria-label={zh ? '3D 视角' : '3D view controls'}>
      <Button disabled={!ready} onClick={() => actions.current?.fit()}>{zh ? '重置 / 适应窗口' : 'Reset / fit view'}</Button>
      <Button disabled={!ready} onClick={() => actions.current?.zoom(1.2)} aria-label={zh ? '缩小模型' : 'Zoom model out'}>−</Button>
      <Button disabled={!ready} onClick={() => actions.current?.zoom(1 / 1.2)} aria-label={zh ? '放大模型' : 'Zoom model in'}>+</Button>
      <span className="mesh-status">{zh ? '科研场景示意 · 未核验' : 'Research illustration · Unverified'}</span>
      <Button disabled={downloading} onClick={() => void download()}>{provenance ? (zh ? '下载模型及署名' : 'Download with attribution') : (zh ? '下载原始 GLB' : 'Download original GLB')}</Button>
    </nav>
    {downloadError && <Feedback kind="error">{downloadError}</Feedback>}
    {error ? <div className="mesh-error"><Feedback kind="error">{error}</Feedback><Button onClick={() => setAttempt(value => value + 1)}>{zh ? '重试 3D 预览' : 'Retry 3D preview'}</Button></div> : !ready && <p role="status">{zh ? '正在检查并载入 GLB…' : 'Checking and loading GLB…'}</p>}
    <div ref={viewport} className="mesh-viewport" onKeyDown={event => {
      const action = actions.current; if (!action || !ready) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); action.orbit(event.key === 'ArrowLeft' ? -0.15 : event.key === 'ArrowRight' ? 0.15 : 0, event.key === 'ArrowUp' ? -0.15 : event.key === 'ArrowDown' ? 0.15 : 0); }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); action.zoom(1 / 1.2); }
      if (event.key === '-') { event.preventDefault(); action.zoom(1.2); }
      if (event.key === 'Home') { event.preventDefault(); action.fit(); }
    }} />
    <footer className="mesh-footer">
      <p>{zh ? '拖动旋转，滚轮缩放。方向键旋转，+ / − 缩放，Home 重置。' : 'Drag to orbit, scroll to zoom. Arrow keys orbit; + / − zoom; Home resets.'}</p>
      {provenance ? <p><a href={provenance.sourceUrl} target="_blank" rel="noreferrer">{provenance.attribution}</a> · <a href={provenance.licenseUrl} target="_blank" rel="noreferrer">CC BY 4.0</a> · {zh ? '原始网格未修改' : 'Original mesh unchanged'}</p> : <p>{zh ? '来源与许可未知，不从文件名推定授权。' : 'Source and license unknown; a filename does not establish permission.'}</p>}
      {details && <Disclosure variant="inline" summary={zh ? '几何信息与单位' : 'Geometry and units'}>
        <p>{details.stats.triangles.toLocaleString()} {zh ? '个三角形' : 'triangles'} · {details.stats.nodes} {zh ? '个节点' : 'nodes'} · {details.stats.materials} {zh ? '个材质' : 'materials'}</p>
        <p>{zh ? '包围盒（X × Y × Z）' : 'Bounds (X × Y × Z)'}: {details.dimensions}. {zh ? 'glTF 以米为约定；源模型尺寸未经计量核验。视角适配不缩放或改写数据。非物理仿真。' : 'glTF convention is metres; source dimensions are not calibrated. Fitting the view does not scale or rewrite data. Not a physics simulation.'}</p>
      </Disclosure>}
    </footer>
  </section>;
}
