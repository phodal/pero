// Shared 3D viewport base for Point Apps (CAD Studio, Scene Studio).
//
// This directory is the only source. The App builder refuses imports that
// resolve outside an App's source root, so `scripts/sync-viewer3d.mjs` copies
// this file to each consuming App's `ui-src/viewer3d/` and a test asserts the
// copies are byte-identical (ADR-0147). Edit here, then run the sync script.
//
// Everything below is renderer-agnostic three.js plumbing with no knowledge of
// either App's document model.

import * as THREE from "three";

/** Release the GPU resources of every mesh below `object`. */
export function disposeObject(object: THREE.Object3D) {
  object.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh && !(node as THREE.Line).isLine && !(node as THREE.Points).isPoints) return;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
      }
      material.dispose?.();
    }
  });
}

/** Frame an object: centre the orbit target and back the camera off to fit. */
export function frameObject(camera: THREE.PerspectiveCamera, controls: { target: THREE.Vector3; update(): unknown }, object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const centre = box.getCenter(new THREE.Vector3());
  const extent = Math.max(box.getSize(new THREE.Vector3()).length(), 1e-4);
  camera.near = extent / 10_000;
  camera.far = extent * 10_000;
  camera.position.copy(centre).add(new THREE.Vector3(extent * 0.8, extent * 0.55, extent * 0.8));
  camera.updateProjectionMatrix();
  controls.target.copy(centre);
  controls.update();
}

/** Read the named views off a bounding box. */
export function viewDirection(name: string, box: THREE.Box3): THREE.Vector3 {
  const centre = box.getCenter(new THREE.Vector3());
  const extent = Math.max(box.getSize(new THREE.Vector3()).length(), 1e-4);
  switch (name) {
    case "top": return new THREE.Vector3(centre.x, centre.y + extent, centre.z);
    case "front": return new THREE.Vector3(centre.x, centre.y, centre.z + extent);
    case "side": return new THREE.Vector3(centre.x + extent, centre.y, centre.z);
    default: return centre.clone().add(new THREE.Vector3(1, 0.8, 1).multiplyScalar(extent * 0.8));
  }
}

/**
 * Call `onSize` with the container's pixel size now and on every resize.
 * Zero-sized containers (hidden panels) are skipped. Returns the disposer.
 */
export function observeSize(container: HTMLElement, onSize: (width: number, height: number) => void): () => void {
  const emit = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width > 0 && height > 0) onSize(width, height);
  };
  const observer = new ResizeObserver(emit);
  observer.observe(container);
  emit();
  return () => observer.disconnect();
}
