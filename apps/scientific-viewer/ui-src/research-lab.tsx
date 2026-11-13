import React from 'react';
import { useAppContext } from '@pero/app-sdk';
import { Button, LibraryHeader } from '@pero/app-sdk/ui';
import manifest from '../assets/research-lab/manifest.json';
import { assetFrom, type Asset } from './files';
import './mesh-preview.css';

export const researchLabAssets = manifest;
export type ResearchLabEntry = typeof manifest[number];

/** Only checked-in, digest-pinned assets are eligible. No user URL or CDN hotlink. */
export async function researchLabAsset(entry: ResearchLabEntry): Promise<Asset> {
  if (!manifest.includes(entry)) throw new Error('Choose a bundled Research Lab model');
  const response = await fetch(`./research-lab/${entry.file}`);
  if (!response.ok) throw new Error(`Could not open ${entry.name} (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== entry.bytes) throw new Error('Bundled model size mismatch');
  const asset = await assetFrom(new File([bytes], entry.file, { type: 'model/gltf-binary' }), {
    source: entry.sourceUrl, license: entry.license,
    provenance: { provider: 'Polyfork', assetId: entry.id, sourceUrl: entry.sourceUrl, licenseUrl: entry.licenseUrl, attribution: entry.attribution, modifications: entry.modifications },
  });
  if (asset.sha256 !== entry.sha256) throw new Error('Bundled model SHA-256 mismatch');
  return asset;
}

export function ResearchLab({ busy, onOpen }: { busy: boolean; onOpen(entry: ResearchLabEntry): void }) {
  const { locale } = useAppContext(), zh = locale === 'zh-CN';
  return <section className="research-lab" aria-label={zh ? '研究实验室' : 'Research Lab'}>
    <LibraryHeader title={zh ? '研究实验室' : 'Research Lab'} subtitle={zh ? '三个精选实验室示意模型' : 'Three selected laboratory illustrations'} />
    <p className="research-lab-intro">{zh ? '打开模型即可旋转和缩放，并在本地保留副本。仅用于科研场景说明，不是计量数据或物理仿真；不是完整模型套件。' : 'Open a model to inspect it in 3D and keep a local copy. These are research illustrations, not measurements or physics simulations. This is a selection, not the full kit.'}</p>
    <ul className="research-lab-list">{manifest.map(entry => <li key={entry.id}>
      <div><h3>{entry.name}</h3><p>Polyfork · CC BY 4.0 · GLB · {(entry.bytes / 1024).toFixed(1)} KiB</p></div>
      <Button disabled={busy} onClick={() => onOpen(entry)} aria-label={`${zh ? '打开' : 'Open'} ${entry.name}`}>{zh ? '打开模型' : 'Open model'}</Button>
    </li>)}</ul>
    <p className="research-lab-intro">{zh ? '模型随应用提供，无需联网。原始网格未修改，下载包含署名与许可。' : 'Bundled for offline use. Original meshes are unchanged; downloads include attribution and license information.'}</p>
    <p><a href="https://polyfork.dev/licensing" target="_blank" rel="noreferrer">{zh ? 'Polyfork 许可与来源' : 'Polyfork licensing and source'}</a></p>
  </section>;
}
