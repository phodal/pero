// Public Mol* core only: the full Viewer bundle eagerly initializes an optional
// MP4 encoder that requires string code generation, prohibited by the App CSP.
import { createPluginUI } from 'molstar/lib/mol-plugin-ui/index.js';
import { DefaultPluginUISpec } from 'molstar/lib/mol-plugin-ui/spec.js';
import { renderReact18 } from 'molstar/lib/mol-plugin-ui/react18.js';
import { PluginConfig } from 'molstar/lib/mol-plugin/config.js';
import { blockStructureDrops } from './files';
export async function createStructureEngine(target: HTMLElement, report: (message: string) => void) {
  const spec = DefaultPluginUISpec();
  spec.layout = { initial: { isExpanded: false, showControls: false } };
  spec.components = { controls: { left: 'none', right: 'none', bottom: 'none' }, remoteState: 'none' };
  spec.config = [
    [PluginConfig.Viewport.ShowControls, false], [PluginConfig.Viewport.ShowSelectionMode, false],
    [PluginConfig.Viewport.ShowSettings, false], [PluginConfig.Viewport.ShowToggleFullscreen, false],
    [PluginConfig.Viewport.ShowExpand, false], [PluginConfig.Viewport.ShowScreenshotControls, false],
    [PluginConfig.VolumeStreaming.Enabled, false],
  ];
  const plugin = await createPluginUI({ target, spec, render: renderReact18,
    onBeforeUIRender: plugin => blockStructureDrops(plugin.managers.dragAndDrop, report),
  });
  if (!plugin.canvas3d) { plugin.dispose(); throw new Error('WebGL structure preview is unavailable'); }
  return {
    dispose: () => plugin.dispose(),
    async loadStructureFromData(data: string, format: 'pdb' | 'mmcif') {
      const raw = await plugin.builders.data.rawData({ data });
      const trajectory = await plugin.builders.structure.parseTrajectory(raw, format);
      await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default');
    },
  };
}
