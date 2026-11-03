import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { defaultMolecule, molecules, type MoleculeIllustration } from './illustrations';
import './explorer.css';

export type ExplorerContext = { locale: 'en' | 'zh-CN'; dark: boolean };
const messages = {
  'zh-CN': { title: '分子', reset: '重置视角', atoms: '个原子', bonds: '个连接', note: '理想化球棍示意，非实验结构或 AI 预测', keyboard: '三维分子，可拖动或用方向键旋转', error: '三维视图不可用，请重试或使用支持 WebGL 的浏览器。', select: '选择分子', retry: '重试' },
  en: { title: 'Molecules', reset: 'Reset view', atoms: 'atoms', bonds: 'bonds', note: 'Idealized geometry, not experimental or AI-predicted', keyboard: '3D molecule. Drag or use arrow keys to rotate.', error: '3D view unavailable. Retry or use a browser with WebGL support.', select: 'Choose a molecule', retry: 'Retry' },
};

/** The website and App mount the same local illustration and controls. No animation. */
export function mountMoleculeExplorer(root: HTMLElement, initial: ExplorerContext) {
  let context = initial, selected = defaultMolecule;
  const events = new AbortController();
  root.innerHTML = `<section class="molecule-explorer">
    <header class="molecule-toolbar"><span class="molecule-title"></span><button type="button" class="molecule-reset"></button></header>
    <div class="molecule-scene"><div class="molecule-canvas" role="img" tabindex="0"></div>
      <div class="molecule-error" hidden><p role="alert"></p><button type="button" class="molecule-retry"></button></div>
      <div class="molecule-caption" aria-live="polite"><strong class="molecule-formula"></strong><span class="molecule-count"></span></div>
      <div class="element-legend" aria-label="Elements"><span><i class="element-c"></i>C</span><span><i class="element-h"></i>H</span><span><i class="element-o"></i>O</span></div>
    </div>
    <footer class="molecule-footer"><div class="molecule-choices" role="group">${molecules.map(m => `<button type="button" data-molecule="${m.id}"></button>`).join('')}</div><p class="molecule-note"></p></footer>
  </section>`;
  const element = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const canvasRoot = element('.molecule-canvas'), errorBox = element('.molecule-error');
  const choices = root.querySelectorAll<HTMLButtonElement>('[data-molecule]');
  let reset = () => {}, rotate = (_key: string) => {}, showMolecule = (_molecule: MoleculeIllustration) => {}, disposeEngine = () => {};
  function updateCopy() {
    const t = messages[context.locale];
    element('.molecule-explorer').dataset.theme = context.dark ? 'dark' : 'light';
    element('.molecule-title').textContent = t.title;
    element('.molecule-reset').textContent = t.reset;
    element('.molecule-note').textContent = t.note;
    element('.molecule-error p').textContent = t.error;
    element('.molecule-retry').textContent = t.retry;
    element('.molecule-formula').textContent = selected.formula;
    element('.molecule-count').textContent = `${selected.atoms.length} ${t.atoms}, ${selected.bonds.length} ${t.bonds}`;
    canvasRoot.setAttribute('aria-label', `${context.locale === 'en' ? selected.en : selected.zh}. ${t.keyboard}`);
    element('.molecule-choices').setAttribute('aria-label', t.select);
    element('.element-legend').setAttribute('aria-label', context.locale === 'en' ? 'Elements' : '元素');
    for (const symbol of ['C', 'H', 'O'] as const) element(`.element-${symbol.toLowerCase()}`).parentElement!.hidden = !selected.atoms.some(atom => atom.element === symbol);
    choices.forEach(button => {
      const molecule = molecules.find(m => m.id === button.dataset.molecule)!;
      button.textContent = context.locale === 'en' ? molecule.en : molecule.zh;
      button.setAttribute('aria-pressed', String(molecule === selected));
    });
  }
  function unavailable() {
    errorBox.hidden = false;
    choices.forEach(button => button.disabled = true);
    element<HTMLButtonElement>('.molecule-reset').disabled = true;
  }
  function initialize() {
    disposeEngine(); canvasRoot.replaceChildren(); errorBox.hidden = true;
    choices.forEach(button => button.disabled = false);
    element<HTMLButtonElement>('.molecule-reset').disabled = false;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
      canvasRoot.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(37, 1, .1, 100), group = new THREE.Group();
      scene.add(group, new THREE.AmbientLight(0xffffff, 1.1));
      for (const [color, intensity, position] of [[0xffffff, 3, [-3, 5, 6]], [0x9abceb, 1.5, [4, -1, -3]], [0xffffff, .8, [-4, -3, 2]]] as const) {
        const light = new THREE.DirectionalLight(color, intensity); light.position.set(position[0], position[1], position[2]); scene.add(light);
      }
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false; controls.minDistance = 3.5; controls.maxDistance = 12;
      const sphere = new THREE.SphereGeometry(1, 40, 28), cylinder = new THREE.CylinderGeometry(1, 1, 1, 14);
      const materials = {
        C: new THREE.MeshPhysicalMaterial({ color: 0x596b7d, metalness: .18, roughness: .24, clearcoat: 1 }),
        H: new THREE.MeshPhysicalMaterial({ color: 0xeaf1f8, metalness: .18, roughness: .24, clearcoat: 1 }),
        O: new THREE.MeshPhysicalMaterial({ color: 0xd9535f, metalness: .18, roughness: .24, clearcoat: 1 }),
      }, radii = { C: .38, H: .23, O: .36 };
      const bondMaterial = new THREE.MeshStandardMaterial({ color: 0x748599, metalness: .3, roughness: .3 });
      const render = () => renderer.render(scene, camera);
      rotate = key => {
        if (key === 'ArrowLeft') group.rotation.y -= .12;
        if (key === 'ArrowRight') group.rotation.y += .12;
        if (key === 'ArrowUp') group.rotation.x -= .12;
        if (key === 'ArrowDown') group.rotation.x += .12;
        render();
      };
      reset = () => {
        group.rotation.set(.24, -.3, -.13);
        const bounds = new THREE.Box3().setFromObject(group), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
        const distance = Math.max(4, (Math.max(size.y, size.x / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) + size.z / 2) * 1.35);
        camera.position.copy(center).add(new THREE.Vector3(0, .15, distance));
        controls.target.copy(center); controls.update(); render();
      };
      showMolecule = molecule => {
        selected = molecule; group.clear();
        const center = new THREE.Vector3(); molecule.atoms.forEach(atom => center.add(new THREE.Vector3(...atom.position))); center.divideScalar(molecule.atoms.length);
        molecule.atoms.forEach(atom => {
          const mesh = new THREE.Mesh(sphere, materials[atom.element]); mesh.scale.setScalar(radii[atom.element]); mesh.position.set(...atom.position).sub(center); group.add(mesh);
        });
        molecule.bonds.forEach(([from, to, order]) => {
          const a = new THREE.Vector3(...molecule.atoms[from].position).sub(center), b = new THREE.Vector3(...molecule.atoms[to].position).sub(center), direction = b.clone().sub(a), mid = a.clone().add(b).multiplyScalar(.5);
          const offset = new THREE.Vector3(-direction.y, direction.x, 0).normalize().multiplyScalar(.085);
          for (let i = 0; i < order; i++) {
            const mesh = new THREE.Mesh(cylinder, bondMaterial); mesh.scale.set(order === 2 ? .045 : .065, direction.length(), order === 2 ? .045 : .065); mesh.position.copy(mid);
            if (order === 2) mesh.position.addScaledVector(offset, i === 0 ? -1 : 1);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()); group.add(mesh);
          }
        });
        reset(); updateCopy();
      };
      controls.addEventListener('change', render);
      const resize = new ResizeObserver(() => {
        const w = canvasRoot.clientWidth, h = canvasRoot.clientHeight; if (!w || !h) return;
        renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); reset();
      });
      resize.observe(canvasRoot);
      renderer.domElement.addEventListener('webglcontextlost', unavailable, { signal: events.signal });
      disposeEngine = () => {
        resize.disconnect(); controls.dispose(); sphere.dispose(); cylinder.dispose(); bondMaterial.dispose();
        Object.values(materials).forEach(material => material.dispose()); renderer.dispose();
      };
      showMolecule(selected);
    } catch { unavailable(); }
  }
  choices.forEach(button => button.addEventListener('click', () => showMolecule(molecules.find(m => m.id === button.dataset.molecule)!), { signal: events.signal }));
  element('.molecule-reset').addEventListener('click', () => reset(), { signal: events.signal });
  element('.molecule-retry').addEventListener('click', initialize, { signal: events.signal });
  canvasRoot.addEventListener('keydown', event => {
    if (!errorBox.hidden || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); rotate(event.key);
  }, { signal: events.signal });
  updateCopy(); initialize();
  return { updateContext(next: ExplorerContext) { context = next; updateCopy(); }, dispose() { events.abort(); disposeEngine(); root.replaceChildren(); } };
}
