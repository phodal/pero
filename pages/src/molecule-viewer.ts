// Idealized ball-and-stick illustrations. Coordinates are not measured or optimized.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './molecule-viewer.css';

type Atom = { element: 'C' | 'H' | 'O'; position: [number, number, number] };
type Bond = readonly [number, number, 1 | 2];
type Molecule = { id: string; zh: string; en: string; formula: string; atoms: Atom[]; bonds: Bond[] };
const molecules: readonly Molecule[] = [
  { id:'water', zh:'水', en:'Water', formula:'H₂O', atoms:[
    {element:'O',position:[0,0,0]}, {element:'H',position:[-.8,-.6,0]}, {element:'H',position:[.8,-.6,0]}
  ], bonds:[[0,1,1],[0,2,1]] },
  { id:'ethanol', zh:'乙醇', en:'Ethanol', formula:'C₂H₆O', atoms:[
    {element:'C',position:[-.8,0,0]}, {element:'C',position:[.65,0,0]}, {element:'O',position:[1.35,1.1,0]},
    {element:'H',position:[2.2,.9,.1]}, {element:'H',position:[-1.3,-.55,.8]}, {element:'H',position:[-1.3,-.55,-.8]},
    {element:'H',position:[-1.2,.95,0]}, {element:'H',position:[.95,-.55,-.85]}, {element:'H',position:[.95,-.6,.85]}
  ], bonds:[[0,1,1],[1,2,1],[2,3,1],[0,4,1],[0,5,1],[0,6,1],[1,7,1],[1,8,1]] },
  { id:'benzene', zh:'苯', en:'Benzene', formula:'C₆H₆', atoms:[...Array.from({length:6},(_,i):Atom=>({element:'C',position:[Math.cos(i*Math.PI/3)*1.15,Math.sin(i*Math.PI/3)*1.15,0]})),...Array.from({length:6},(_,i):Atom=>({element:'H',position:[Math.cos(i*Math.PI/3)*2.05,Math.sin(i*Math.PI/3)*2.05,0]}))], bonds:[...Array.from({length:6},(_,i):Bond=>[i,(i+1)%6,i%2===0?2:1]),...Array.from({length:6},(_,i):Bond=>[i,i+6,1])] }
];
const messages = {
  zh: {hint:'拖动旋转，看看它的另一面。',reset:'重置视角',atoms:'个原子',bonds:'个连接',note:'理想化球棍示意 · 非实验结构或 AI 预测',keyboard:'可拖动或用方向键旋转的三维分子',error:'三维视图暂不可用，请尝试支持 WebGL 的浏览器。',select:'选择分子'},
  en: {hint:'Drag to rotate. See another side.',reset:'Reset view',atoms:'atoms',bonds:'connections',note:'Idealized ball-and-stick illustration · not experimental or AI-predicted',keyboard:'3D molecule. Drag or use arrow keys to rotate.',error:'3D is unavailable. Try a browser with WebGL support.',select:'Choose a molecule'}
};
let locale: keyof typeof messages = 'zh', selected = molecules[1];
const root = document.getElementById('molecule-root')!;
root.innerHTML = '<main class="molecule-explorer"><header><span>MOLECULAR EXPLORER</span><button id="reset-view"></button></header><div class="molecule-scene"><div class="molecule-intro"><p id="viewer-hint"></p></div><div id="molecule-canvas" role="img" tabindex="0"></div><p id="viewer-error" role="status" hidden></p><div class="molecule-caption"><strong id="molecule-formula"></strong><span id="molecule-count"></span></div><div class="element-legend"><span><i class="element-c"></i>C</span><span><i class="element-h"></i>H</span><span><i class="element-o"></i>O</span></div></div><footer><div id="molecule-choices" role="group">'+molecules.map(m=>'<button data-molecule="'+m.id+'"></button>').join('')+'</div><p id="viewer-note"></p></footer></main>';
const canvasRoot = document.getElementById('molecule-canvas')!;
function updateCopy() {
  const t = messages[locale];
  document.documentElement.lang=locale==='zh'?'zh-CN':'en';
  document.getElementById('viewer-hint')!.textContent=t.hint;
  document.getElementById('reset-view')!.textContent=t.reset;
  document.getElementById('viewer-note')!.textContent=t.note;
  document.getElementById('viewer-error')!.textContent=t.error;
  document.getElementById('molecule-formula')!.textContent=selected.formula;
  document.getElementById('molecule-count')!.textContent=selected.atoms.length+' '+t.atoms+' · '+selected.bonds.length+' '+t.bonds;
  canvasRoot.setAttribute('aria-label',(locale==='zh'?selected.zh:selected.en)+' · '+t.keyboard);
  document.getElementById('molecule-choices')!.setAttribute('aria-label',t.select);
  document.querySelectorAll<HTMLButtonElement>('[data-molecule]').forEach(button=>{const molecule=molecules.find(m=>m.id===button.dataset.molecule)!;button.textContent=locale==='zh'?molecule.zh:molecule.en;button.setAttribute('aria-pressed',String(molecule===selected));});
}
updateCopy();
window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.data?.type!=='pero:app:context')return;
  const value=event.data.context;
  if(!value||!['en','zh-CN'].includes(value.locale)||typeof value.dark!=='boolean')return;
  document.documentElement.dataset.theme=value.dark?'dark':'light';
  locale=value.locale==='en'?'en':'zh';updateCopy();
});
window.parent.postMessage({type:'pero:app:ready'},location.origin);

try {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  canvasRoot.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(37,1,.1,100),group=new THREE.Group();
  scene.add(group,new THREE.AmbientLight(0xffffff,1.1));
  const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(-3,5,6);scene.add(key);
  const rim=new THREE.DirectionalLight(0x9abceb,1.5);rim.position.set(4,-1,-3);scene.add(rim);
  const fill=new THREE.DirectionalLight(0xffffff,.8);fill.position.set(-4,-3,2);scene.add(fill);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enablePan=false;controls.minDistance=3.5;controls.maxDistance=12;
  const sphere=new THREE.SphereGeometry(1,40,28),cylinder=new THREE.CylinderGeometry(1,1,1,14);
  const colors={C:0x596b7d,H:0xeaf1f8,O:0xd9535f},radii={C:.38,H:.23,O:.36};
  const materials=Object.fromEntries(Object.entries(colors).map(([element,color])=>[element,new THREE.MeshPhysicalMaterial({color,metalness:.18,roughness:.24,clearcoat:1,clearcoatRoughness:.2})]));
  const bondMaterial=new THREE.MeshStandardMaterial({color:0x748599,metalness:.3,roughness:.3});
  const render=()=>renderer.render(scene,camera);
  const reset=()=>{
    group.rotation.set(.24,-.3,-.13);
    const bounds=new THREE.Box3().setFromObject(group),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    const distance=Math.max(4,(Math.max(size.y,size.x/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))+size.z/2)*1.2);
    camera.position.copy(center).add(new THREE.Vector3(0,.15,distance));
    controls.target.copy(center);controls.update();render();
  };
  function showMolecule(molecule:Molecule) {
    selected=molecule;group.clear();
    const center=new THREE.Vector3();molecule.atoms.forEach(atom=>center.add(new THREE.Vector3(...atom.position)));center.divideScalar(molecule.atoms.length);
    molecule.atoms.forEach(atom=>{const mesh=new THREE.Mesh(sphere,materials[atom.element]);mesh.scale.setScalar(radii[atom.element]);mesh.position.set(...atom.position).sub(center);group.add(mesh);});
    molecule.bonds.forEach(([from,to,order])=>{
      const a=new THREE.Vector3(...molecule.atoms[from].position).sub(center),b=new THREE.Vector3(...molecule.atoms[to].position).sub(center),direction=b.clone().sub(a),mid=a.clone().add(b).multiplyScalar(.5);
      const offset=new THREE.Vector3(-direction.y,direction.x,0).normalize().multiplyScalar(.085);
      for(let i=0;i<order;i++){const mesh=new THREE.Mesh(cylinder,bondMaterial);mesh.scale.set(order===2?.045:.065,direction.length(),order===2?.045:.065);mesh.position.copy(mid);if(order===2)mesh.position.addScaledVector(offset,i===0?-1:1);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());group.add(mesh);}
    });
    reset();updateCopy();
  }
  controls.addEventListener('change',render);
  new ResizeObserver(()=>{const w=canvasRoot.clientWidth,h=canvasRoot.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();reset();}).observe(canvasRoot);
  document.querySelectorAll<HTMLButtonElement>('[data-molecule]').forEach(button=>button.addEventListener('click',()=>showMolecule(molecules.find(m=>m.id===button.dataset.molecule)!)));
  document.getElementById('reset-view')!.addEventListener('click',reset);
  canvasRoot.addEventListener('keydown',event=>{const delta=.12;if(event.key==='ArrowLeft')group.rotation.y-=delta;else if(event.key==='ArrowRight')group.rotation.y+=delta;else if(event.key==='ArrowUp')group.rotation.x-=delta;else if(event.key==='ArrowDown')group.rotation.x+=delta;else return;event.preventDefault();render();});
  renderer.domElement.addEventListener('webglcontextlost',()=>{document.getElementById('viewer-error')!.hidden=false;});
  showMolecule(selected);
} catch {
  document.getElementById('viewer-error')!.hidden=false;
  document.querySelectorAll<HTMLButtonElement>('[data-molecule],#reset-view').forEach(button=>button.disabled=true);
}
