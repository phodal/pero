import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useAppInfo, useTheme } from '@pero/app-sdk';
import { seriesStyle } from '@pero/app-sdk/chart';
import { Button, Feedback } from '@pero/app-sdk/ui';
import { disposeObject, observeSize } from '../viewer3d';
import type { Volume } from '../science';
import type { Translate } from '../messages';

const vertex = `out vec3 at; void main(){at=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
// Front-to-back emission/absorption with subvoxel integration and gradient
// lighting over the supplied scalar channels.
// Lighting affects display color only. Slices retain the original intensities.
const fragment = `precision highp float; precision highp sampler3D;
uniform sampler3D volume; uniform vec3 eye, enabled, dimensions, physicalScale, c0, c1, c2; uniform float density, threshold, cut, opacity; uniform bool surface;
in vec3 at; out vec4 result;
float signal(vec3 p){return dot(max(texture(volume,p).rgb-vec3(threshold),vec3(0.)),enabled);}
vec3 gradient(vec3 p){
 vec3 h=1./dimensions;
 return vec3(signal(p+vec3(h.x,0.,0.))-signal(p-vec3(h.x,0.,0.)),
             signal(p+vec3(0.,h.y,0.))-signal(p-vec3(0.,h.y,0.)),
             signal(p+vec3(0.,0.,h.z))-signal(p-vec3(0.,0.,h.z)))/(2.*h*physicalScale);
}
vec3 channelGradient(vec3 p,int channel){
 vec3 h=1./dimensions;
 return vec3(texture(volume,p+vec3(h.x,0.,0.))[channel]-texture(volume,p-vec3(h.x,0.,0.))[channel],
             texture(volume,p+vec3(0.,h.y,0.))[channel]-texture(volume,p-vec3(0.,h.y,0.))[channel],
             texture(volume,p+vec3(0.,0.,h.z))[channel]-texture(volume,p-vec3(0.,0.,h.z))[channel])/(2.*h*physicalScale);
}
void main(){
 vec3 dir=normalize(at-eye), inv=sign(dir+vec3(1.e-9))/max(abs(dir),vec3(1.e-6));
 vec3 ta=(-vec3(.5)-eye)*inv, tb=(vec3(.5)-eye)*inv;
 vec3 lo=min(ta,tb),hi=max(ta,tb);
 float start=max(max(lo.x,lo.y),lo.z), stop=min(min(hi.x,hi.y),hi.z);
 if(stop<max(start,0.)) discard;
 start=max(start,0.);
 int steps=int(clamp(ceil((stop-start)*length(dir*dimensions)/.35),1.,384.));
 float stepSize=(stop-start)/float(steps); vec4 acc=vec4(0.);
 vec3 viewer=-normalize(dir*physicalScale), light=normalize(viewer+vec3(.35,.5,.15));
 bvec3 found=lessThan(enabled,vec3(.5));
 for(int i=0;i<384;i++){
  if(i>=steps) break;
  vec3 pos=eye+dir*(start+(float(i)+.5)*stepSize);
  if(pos.z+.5>cut) continue;
  vec3 raw=texture(volume,pos+.5).rgb;
  if(surface){
   // First threshold crossing per channel, refined in the original texture.
   // Transparency retains interior channels without inventing new geometry.
   for(int channel=0;channel<3;channel++){
    if(found[channel] || raw[channel]<threshold) continue;
    vec3 lo=pos-dir*stepSize, hi=pos;
    for(int j=0;j<5;j++){
     vec3 mid=(lo+hi)*.5;
     if(texture(volume,mid+.5)[channel]<threshold) lo=mid; else hi=mid;
    }
    vec3 g=channelGradient((lo+hi)*.5+.5,channel);
    vec3 normal=length(g)>.001 ? normalize(-g) : viewer;
    if(dot(normal,viewer)<0.) normal=-normal;
    float diffuse=max(dot(normal,light),0.);
    float specular=pow(max(dot(normal,normalize(light+viewer)),0.),32.);
    vec3 color=channel==0 ? c0 : channel==1 ? c1 : c2;
    color=color*(.35+.65*diffuse)+vec3(.12*specular);
    acc.rgb+=(1.-acc.a)*opacity*color; acc.a+=(1.-acc.a)*opacity;
    found[channel]=true;
   }
   if(all(found)) break;
   continue;
  }
  vec3 v=raw*enabled;
  v=max(v-vec3(threshold),vec3(0.));
  float sum=v.r+v.g+v.b, a=1.-exp(-sum*density*stepSize*12.);
  if(a<.0001) continue;
  vec3 rgb=(v.r*c0+v.g*c1+v.b*c2)/max(sum,.00001);
  vec3 g=gradient(pos+.5);
  float shade=length(g)>.001 ? .55+.45*abs(dot(normalize(g),light)) : 1.;
  rgb*=shade;
  acc.rgb+=(1.-acc.a)*a*rgb; acc.a+=(1.-acc.a)*a;
  if(acc.a>.98) break;
 }
 result=linearToOutputTexel(vec4(acc.rgb/max(acc.a,.00001),acc.a));
}`;

export type VolumeRenderMode = 'volume' | 'surface';
type Viewport = { update(visible: boolean[], density: number, threshold: number, cut: number, mode: VolumeRenderMode, opacity: number): void; view(axis: string): void; theme(): void; enabled(value: boolean): void };
export function VolumeCanvas({ document, visible, density, threshold, cut, mode, opacity, t }: { document: Volume; visible: boolean[]; density: number; threshold: number; cut: number; mode: VolumeRenderMode; opacity: number; t: Translate }) {
  const root = useRef<HTMLDivElement>(null), engine = useRef<Viewport | null>(null), [error, setError] = useState('');
  const theme = useTheme(), { active } = useAppInfo();
  const settings = useRef({ visible, density, threshold, cut, mode, opacity }); settings.current = { visible, density, threshold, cut, mode, opacity };
  useEffect(() => {
    const element = root.current!; let renderer: THREE.WebGLRenderer | undefined, disposeSize = () => {}, controls: OrbitControls | undefined, mesh: THREE.Mesh | undefined, texture: THREE.Data3DTexture | undefined;
    setError('');
    const onLost = (event: Event) => { event.preventDefault(); setError('WebGL context lost'); };
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); element.appendChild(renderer.domElement);
      renderer.domElement.addEventListener('webglcontextlost', onLost);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .01, 100);
      camera.position.set(1.2, .8, 1.5);
      controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false; controls.minDistance = .85; controls.maxDistance = 5;
      const [nx, ny, nz] = document.dimensions, size = nx * ny * nz, data = new Uint16Array(size * 4);
      // Half-float is linearly filterable in WebGL2 and retains weak signals
      // that rounding every imported channel to 8 bits used to discard.
      document.channels.forEach((channel, c) => channel.values.forEach((v, i) => { data[i * 4 + c] = THREE.DataUtils.toHalfFloat(v); }));
      texture = new THREE.Data3DTexture(data, nx, ny, nz); texture.format = THREE.RGBAFormat; texture.type = THREE.HalfFloatType; texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.unpackAlignment = 1; texture.needsUpdate = true;
      const physical = document.dimensions.map((n, i) => n * document.spacing[i]), max = Math.max(...physical), physicalScale = physical.map(n => n / max) as [number, number, number];
      const uniforms = { volume: { value: texture }, eye: { value: new THREE.Vector3() }, enabled: { value: new THREE.Vector3(1, 1, 1) }, dimensions: { value: new THREE.Vector3(nx, ny, nz) }, physicalScale: { value: new THREE.Vector3(...physicalScale) }, density: { value: density }, threshold: { value: threshold }, cut: { value: cut }, surface: { value: mode === 'surface' }, opacity: { value: opacity }, c0: { value: new THREE.Color() }, c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() } };
      const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, glslVersion: THREE.GLSL3, uniforms, transparent: true, side: THREE.BackSide });
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.scale.set(...physicalScale); scene.add(mesh);
      const outline = new THREE.Box3Helper(new THREE.Box3().setFromObject(mesh)); scene.add(outline);
      const render = () => { mesh!.updateMatrixWorld(); uniforms.eye.value.copy(camera.position); mesh!.worldToLocal(uniforms.eye.value); renderer!.render(scene, camera); };
      controls.addEventListener('change', render);
      const viewport: Viewport = {
        update: (visible, density, threshold, cut, mode, opacity) => { uniforms.enabled.value.set(...[0, 1, 2].map(i => visible[i] ? 1 : 0) as [number, number, number]); uniforms.density.value = density; uniforms.threshold.value = threshold; uniforms.cut.value = cut; uniforms.surface.value = mode === 'surface'; uniforms.opacity.value = opacity; render(); },
        view: axis => { camera.position.set(...(axis === 'x' ? [2, 0, 0] : axis === 'y' ? [0, 2, 0] : axis === 'z' ? [0, 0, 2] : [1.2, .8, 1.5]) as [number, number, number]); controls!.target.set(0, 0, 0); controls!.update(); render(); },
        theme: () => { [0, 1, 2].forEach(i => uniforms[`c${i}`].value.set(seriesStyle([1, 5, 3][i]).stroke)); (outline.material as THREE.LineBasicMaterial).color.set(seriesStyle(0).stroke); render(); },
        enabled: value => { controls!.enabled = value; },
      };
      engine.current = viewport; viewport.theme();
      viewport.update(settings.current.visible, settings.current.density, settings.current.threshold, settings.current.cut, settings.current.mode, settings.current.opacity);
      disposeSize = observeSize(element, (w, h) => { renderer!.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); render(); });
      return () => { engine.current = null; disposeSize(); controls?.dispose(); disposeObject(scene); texture?.dispose(); renderer!.domElement.removeEventListener('webglcontextlost', onLost); renderer!.dispose(); renderer!.domElement.remove(); };
    } catch (error: any) {
      disposeSize(); controls?.dispose(); if (mesh) disposeObject(mesh); texture?.dispose(); renderer?.dispose(); renderer?.domElement.remove(); setError(error.message || String(error));
    }
  }, [document]);
  useEffect(() => engine.current?.update(visible, density, threshold, cut, mode, opacity), [visible, density, threshold, cut, mode, opacity]);
  useEffect(() => engine.current?.theme(), [theme.id, theme.mode]);
  useEffect(() => engine.current?.enabled(active), [active]);
  return <div className="vc-volume-wrap"><div ref={root} className="vc-volume-canvas" role="img" aria-label={t(mode === 'surface' ? 'surfaceRender' : 'volumeRender')}/>{error && <Feedback kind="error">{error}</Feedback>}
    <div className="vc-view-tools">{['x', 'y', 'z', 'resetView'].map(axis => <Button key={axis} onClick={() => engine.current?.view(axis)}>{axis === 'resetView' ? t('resetView') : axis.toUpperCase()}</Button>)}</div>
  </div>;
}

export function VolumeSlice({ document, axis, fraction, visible, t }: { document: Volume; axis: number; fraction: number; visible: boolean[]; t: Translate }) {
  const ref = useRef<HTMLCanvasElement>(null), theme = useTheme();
  useEffect(() => {
    const plane = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1], width = document.dimensions[plane[0]], height = document.dimensions[plane[1]], canvas = ref.current!, ctx = canvas.getContext('2d')!;
    canvas.width = width; canvas.height = height;
    const image = ctx.createImageData(width, height), colors = [1, 5, 3].map(i => new THREE.Color(seriesStyle(i).stroke));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = [0, 0, 0]; at[axis] = Math.round(fraction * (document.dimensions[axis] - 1)); at[plane[0]] = x; at[plane[1]] = height - y - 1;
      const index = at[0] + document.dimensions[0] * (at[1] + document.dimensions[1] * at[2]), target = (y * width + x) * 4;
      document.channels.forEach((c, i) => { if (!visible[i]) return; const rgb = colors[i].clone().convertLinearToSRGB(); [rgb.r, rgb.g, rgb.b].forEach((v, k) => { image.data[target + k] += Math.round(c.values[index] * v * 255); }); }); image.data[target + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [document, axis, fraction, visible, theme.id, theme.mode]);
  const plane = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  return <canvas ref={ref} role="img" aria-label={`${'XYZ'[axis]} · ${t('slice')}`} style={{ aspectRatio: `${document.dimensions[plane[0]] * document.spacing[plane[0]]} / ${document.dimensions[plane[1]] * document.spacing[plane[1]]}` }}/>;
}
