import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';

type Cdp = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type FrameTree = {
  frame: { id: string; loaderId: string; securityOrigin: string };
  childFrames?: FrameTree[];
};
type CdpNode = {
  nodeId: string;
  ignored: boolean;
  role?: { value?: string };
  name?: { value?: string };
  properties?: { name: string; value: { value?: unknown } }[];
  childIds?: string[];
  backendDOMNodeId?: number;
};
type AxNode = {
  id: string;
  role: string;
  name?: string;
  state?: Record<string, boolean | number | string>;
  children?: string[];
};
type FrameNodes = { id: string; nodes: CdpNode[]; frames: Map<number, FrameNodes> };
type AxSnapshot = { id: string; document: string; rootId: string; nodes: AxNode[] };

const axStates = new Set([
  'checked', 'disabled', 'expanded', 'focused', 'invalid', 'level', 'multiselectable',
  'pressed', 'readonly', 'required', 'selected',
]);

/** One snapshot baseline per debugger attachment. AX IDs identify structure, not action targets. */
export class ChromiumAccessibility {
  private enabled = false;
  private latest?: AxSnapshot;

  async observe(send: Cdp, origin: string, document: string, since: string | undefined, check: () => void) {
    check();
    if (!this.enabled) {
      await send('Accessibility.enable');
      this.enabled = true;
    }
    const getFrames = async () => (await send('Page.getFrameTree') as { frameTree: FrameTree }).frameTree;
    const first = await getFrames();
    if (webOrigin(first.frame.securityOrigin) !== origin) throw new Error('The accessibility tree is outside the approved origin.');
    const captured = new Map<string, string>();
    let truncated = false;
    const readFrame = async (tree: FrameTree, level: number): Promise<FrameNodes> => {
      check();
      captured.set(tree.frame.id, tree.frame.loaderId);
      const { nodes } = await send('Accessibility.getFullAXTree', { frameId: tree.frame.id, depth: 24 }) as { nodes: CdpNode[] };
      const frames = new Map<number, FrameNodes>();
      const owners = new Set(nodes.filter(node => !node.ignored && node.backendDOMNodeId !== undefined)
        .map(node => node.backendDOMNodeId));
      for (const child of tree.childFrames ?? []) {
        if (webOrigin(child.frame.securityOrigin) !== origin) continue;
        if (level === 3 || captured.size === 8) { truncated = true; break; }
        check();
        const { backendNodeId } = await send('DOM.getFrameOwner', { frameId: child.frame.id }) as { backendNodeId: number };
        if (owners.has(backendNodeId)) frames.set(backendNodeId, await readFrame(child, level + 1));
      }
      return { id: tree.frame.id, nodes, frames };
    };
    const raw = await readFrame(first, 0);
    const verifyFrames = (tree: FrameTree) => {
      const loader = captured.get(tree.frame.id);
      if (loader !== undefined && (loader !== tree.frame.loaderId || webOrigin(tree.frame.securityOrigin) !== origin))
        throw new Error('A document changed during the accessibility observation.');
      captured.delete(tree.frame.id);
      for (const child of tree.childFrames ?? []) verifyFrames(child);
    };
    const last = await getFrames();
    if (last.frame.id !== first.frame.id) throw new Error('The accessibility document changed.');
    verifyFrames(last);
    check();
    if (captured.size) throw new Error('A frame closed during the accessibility observation.');

    const nodes: AxNode[] = [];
    const installed = new Set<string>();
    const walkFrame = (frame: FrameNodes): string[] => {
      const lookup = new Map(frame.nodes.map(node => [node.nodeId, node]));
      const visited = new Set<string>();
      const walk = (nodeId: string): string[] => {
        const node = lookup.get(nodeId);
        if (!node) { truncated = true; return []; }
        if (visited.has(nodeId)) return [];
        visited.add(nodeId);
        const role = node.role?.value;
        if (node.ignored || !role) return (node.childIds ?? []).flatMap(walk);
        if (role === 'InlineTextBox') return [];
        if (nodes.length === 240) { truncated = true; return []; }
        const id = frame.id + '/' + node.nodeId;
        if (installed.has(id)) return [];
        installed.add(id);
        const entry: AxNode = { id, role };
        if (node.name?.value) entry.name = node.name.value.slice(0, 240);
        const state = Object.fromEntries((node.properties ?? []).flatMap(({ name, value }) => {
          const scalar = value.value;
          return axStates.has(name) && (typeof scalar === 'boolean' || typeof scalar === 'number' || typeof scalar === 'string')
            ? [[name, typeof scalar === 'string' ? scalar.slice(0, 48) : scalar]] : [];
        }));
        if (Object.keys(state).length) entry.state = state;
        nodes.push(entry);
        const children = (node.childIds ?? []).flatMap(walk);
        const childFrame = node.backendDOMNodeId === undefined ? undefined : frame.frames.get(node.backendDOMNodeId);
        if (childFrame) children.push(...walkFrame(childFrame));
        if (children.length) entry.children = children;
        return [id];
      };
      const root = frame.nodes[0];
      return root ? walk(root.nodeId) : [];
    };
    const [rootId] = walkFrame(raw);
    if (!rootId) throw new Error('Chromium did not provide an accessibility root.');

    const baseline = this.latest;
    const id = crypto.randomUUID();
    this.latest = { id, document, rootId, nodes };
    const common = { kind: 'axState' as const, snapshotId: id, rootId, truncated };
    if (since && baseline?.id === since && baseline.document === document && baseline.rootId === rootId) {
      const old = new Map(baseline.nodes.map(node => [node.id, JSON.stringify(node)]));
      const upserted = nodes.filter(node => old.get(node.id) !== JSON.stringify(node));
      return { ...common, full: false as const, baseSnapshotId: since, upserted, removed: baseline.nodes
        .filter(node => !installed.has(node.id)).map(node => node.id) };
    }
    return { ...common, full: true as const, nodes, ...(since && { baselineReset: true }) };
  }
}
