import { scientificReferenceState, type NotebookNode, type ScientificReference } from "./document.ts";

/**
 * Versioned projection of a Notebook document.
 *
 * The notebook node tree stays the stored document. BlockNote's block id and
 * MyST's cite identifier are export views. Neither view is a second copy of a
 * dataset, run, or evidence record.
 */
export const interchangeVersion = "pero-notebook-interchange/1";

/** Block types accepted by the Notebook document parser, including the retention envelope. */
export const persistedBlockTypes = [
  "paragraph", "heading", "blockquote", "horizontalRule", "codeBlock",
  "bulletList", "orderedList", "taskList", "spreadsheet", "evidence",
  "experiment", "finding", "section", "attachment", "savedSearch", "inputTable",
  "registrationTable", "lookupTable", "mixturePrep", "appCanvas", "sampleIntake",
  "reactionScheme", "chemical", "sourceExcerpt", "namedReference", "noteCard", "retainedBlock",
] as const;

const knownTypes = new Set<string>([
  "doc", "text", "hardBreak", "referenceMention", "listItem", "taskItem",
  ...persistedBlockTypes,
]);

const referenceTypes = new Set(["evidence", "experiment"]);
const blockIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

export interface Loss {
  path: string;
  target: "myst" | "blockNote";
  code: string;
  detail: string;
}

export interface BlockNoteText {
  type: "text";
  text: string;
  styles: Record<string, true>;
}

/** Scalar props only, matching BlockNote's prop schema. */
export interface BlockNoteBlock {
  id: string;
  type: string;
  props: Record<string, string | number | boolean>;
  content?: BlockNoteText[];
  children: [];
}

export interface Projection {
  version: typeof interchangeVersion;
  /** Exact stored tree. Export views do not replace this. */
  canonical: NotebookNode;
  myst: { type: "root"; children: unknown[] };
  blockNote: BlockNoteBlock[];
  /** Representations that omit something the stored node still has. */
  withheld: { path: string; myst?: unknown; blockNote?: BlockNoteBlock }[];
  losses: Loss[];
}

interface Attempt {
  myst?: unknown;
  block?: BlockNoteBlock;
  losses: Loss[];
}

export interface Protection {
  content: NotebookNode;
  changed: boolean;
  errors: string[];
}

export function readStoredReference(node: NotebookNode): { editorBlockId: string | null; reference: ScientificReference | null } {
  const raw = node.attrs?.blockId;
  const editorBlockId = typeof raw === "string" && blockIdPattern.test(raw) ? raw : null;
  const source = node.attrs?.source;
  if (!source || typeof source !== "object") return { editorBlockId, reference: null };
  const record = source as Record<string, unknown>;
  if (!["app", "kind", "id", "version", "locator"].every(key => typeof record[key] === "string")) return { editorBlockId, reference: null };
  return { editorBlockId, reference: source as ScientificReference };
}

export function canReplace(projection: Projection, target: Loss["target"]): boolean {
  return !projection.losses.some(loss => loss.target === target);
}

export function projectNotebook(content: NotebookNode): Projection {
  if (content.type !== "doc" || !Array.isArray(content.content)) throw new Error("Notebook interchange requires a document with a content array");
  const canonical = structuredClone(content);
  const children = content.content;
  const projected = projectChildren(children, handlers, "");
  return {
    version: interchangeVersion,
    canonical,
    myst: { type: "root", children: projected.myst },
    blockNote: projected.blockNote,
    withheld: projected.withheld,
    losses: [...unrepresented(content, "root", []), ...projected.losses],
  };
}

/** Restore this adapter's projection; not a general BlockNote JSON importer. */
export function restoreBlockNote(projection: Projection): NotebookNode {
  if (!canReplace(projection, "blockNote")) throw new Error("BlockNote projection is incomplete");
  return { type: "doc", content: projection.blockNote.map(restoreBlock) };
}

/** Restore this adapter's projection; not a general MyST JSON importer. */
export function restoreMyst(projection: Projection): NotebookNode {
  if (!canReplace(projection, "myst")) throw new Error("MyST projection is incomplete");
  return { type: "doc", content: projection.myst.children.map((node, index) => restoreMystNode(node, String(index))) };
}

/**
 * Keep a node the editor does not understand. A known document is returned
 * unchanged. An unknown node without an editor block id is refused, not deleted.
 */
export function protectUnknownNodes(root: NotebookNode): Protection {
  const visited = visit(root, "content");
  if (visited.errors.length) return { content: root, changed: false, errors: visited.errors };
  return { content: visited.changed ? visited.node : root, changed: visited.changed, errors: [] };
}

export function restoreRetainedNodes(node: NotebookNode): NotebookNode {
  if (node.type === "retainedBlock" && isNode(node.attrs?.payload)) return restoreRetainedNodes(node.attrs.payload);
  if (!node.content) return node;
  let changed = false;
  const content = node.content.map(child => {
    const restored = restoreRetainedNodes(child);
    changed ||= restored !== child;
    return restored;
  });
  return changed ? { ...node, content } : node;
}

function projectChildren(nodes: NotebookNode[], handlers: Record<string, (node: NotebookNode, path: string) => Attempt>, prefix: string) {
  const myst: unknown[] = [];
  const blockNote: BlockNoteBlock[] = [];
  const withheld: Projection["withheld"] = [];
  const losses: Loss[] = [];
  nodes.forEach((node, index) => {
    const path = prefix ? `${prefix}.${index}` : String(index);
    const handler = handlers[node.type];
    const attempt = handler ? handler(node, path) : {
      losses: both(path, "outside-subset", `${node.type} is outside the v1 interchange subset and was not flattened`),
    };
    losses.push(...attempt.losses);
    const mystReady = attempt.myst !== undefined && !attempt.losses.some(loss => loss.target === "myst");
    const blockReady = attempt.block !== undefined && !attempt.losses.some(loss => loss.target === "blockNote");
    if (mystReady) myst.push(attempt.myst);
    if (blockReady && attempt.block) blockNote.push(attempt.block);
    if ((attempt.myst !== undefined && !mystReady) || (attempt.block && !blockReady)) {
      withheld.push({ path, ...(attempt.myst !== undefined && !mystReady ? { myst: attempt.myst } : {}), ...(attempt.block && !blockReady ? { blockNote: attempt.block } : {}) });
    }
  });
  return { myst, blockNote, withheld, losses };
}

const handlers: Record<string, (node: NotebookNode, path: string) => Attempt> = {
  paragraph: proseHandler,
  heading: proseHandler,
  codeBlock: proseHandler,
  evidence: referenceHandler,
  experiment: referenceHandler,
  spreadsheet: (_node, path) => ({ losses: both(path, "formula-not-exported", "Spreadsheet formulas stay in the notebook sheet. They are not BlockNote table cells, MyST phrasing cells, or a new computed result.") }),
  inputTable: (_node, path) => ({ losses: both(path, "table-content-is-not-measurement", "A structured table keeps its own rows, types, and units. BlockNote TableContent and MyST table cells are rich text, so this table was not exported.") }),
  registrationTable: (_node, path) => ({ losses: both(path, "table-content-is-not-measurement", "A registration table is not rich-text table content and was not exported.") }),
  lookupTable: (_node, path) => ({ losses: both(path, "table-content-is-not-measurement", "A lookup table is not rich-text table content and was not exported.") }),
  retainedBlock: (_node, path) => ({ losses: both(path, "retained-envelope", "The original block is inside the retention envelope and was not converted.") }),
};

function proseHandler(node: NotebookNode, path: string): Attempt {
  const losses: Loss[] = [];
  const children = node.content ?? [];
  const texts: BlockNoteText[] = [];
  const mystChildren: unknown[] = [];
  children.forEach((child, index) => {
    const childPath = `${path}.${index}`;
    if (child.type === "text") {
      const text = textAttempt(child, childPath);
      losses.push(...text.losses);
      if (text.myst) mystChildren.push(text.myst);
      if (text.text) texts.push(text.text);
      return;
    }
    losses.push(...both(childPath, "outside-subset", `${child.type} inside ${node.type} is outside the v1 inline subset and was not dropped`));
  });
  const level = node.attrs?.level;
  if (node.type === "heading" && (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 6)) losses.push(...both(path, "invalid-heading-level", "Heading depth must be between 1 and 6"));
  if (node.type === "codeBlock") {
    if (children.some(child => child.marks?.length)) losses.push(...both(path, "marked-code", "Code blocks carry plain text, not text marks"));
    if (children.length > 1) losses.push({ path, target: "myst", code: "code-text-segments", detail: "MyST code has one value and cannot preserve separate text nodes" });
  }
  if (node.type === "codeBlock" && node.attrs?.language !== undefined && typeof node.attrs.language !== "string") {
    losses.push(...both(path, "outside-subset", "Code language is not a string"));
  }
  const represented = node.type === "heading" ? ["blockId", "level"] : node.type === "codeBlock" ? ["blockId", "language"] : ["blockId"];
  losses.push(...unrepresented(node, path, represented));
  const id = editorBlockId(node);
  if (!id) losses.push({ path, target: "blockNote", code: "missing-editor-block-id", detail: "No editor block id was invented for this block" });
  const language = node.attrs?.language;
  const props: Record<string, string | number | boolean> = {};
  if (node.type === "heading" && Number.isInteger(level)) props.level = level as number;
  if (node.type === "codeBlock" && typeof language === "string") props.language = language;
  const identity = id ? { data: { editorBlockId: id } } : {};
  const myst = node.type === "heading"
    ? { type: "heading", depth: level, children: mystChildren, ...identity }
    : node.type === "codeBlock"
      ? { type: "code", value: texts.map(item => item.text).join(""), ...(typeof language === "string" ? { lang: language } : {}), ...identity }
      : { type: "paragraph", children: mystChildren, ...identity };
  const block: BlockNoteBlock | undefined = id ? {
    id,
    type: node.type,
    props,
    content: texts,
    children: [],
  } : undefined;
  return { myst, block, losses };
}

function textAttempt(node: NotebookNode, path: string): { myst?: unknown; text?: BlockNoteText; losses: Loss[] } {
  if (typeof node.text !== "string") return { losses: both(path, "outside-subset", "Text node has no string value") };
  const losses = unrepresented(node, path, []);
  const marks = node.marks ?? [];
  const unsupported = marks.some(mark => !["bold", "italic", "code"].includes(mark.type) || (mark.attrs !== undefined && Object.keys(mark.attrs).length > 0));
  if (unsupported || (marks.some(mark => mark.type === "code") && marks.length > 1)) {
    return { losses: both(path, "mark-outside-subset", "The text mark is outside the v1 subset and was not stripped") };
  }
  const styles: Record<string, true> = {};
  for (const mark of marks) styles[mark.type] = true;
  let myst: unknown = styles.code ? { type: "inlineCode", value: node.text } : { type: "text", value: node.text };
  if (!styles.code && styles.italic) myst = { type: "emphasis", children: [myst] };
  if (!styles.code && styles.bold) myst = { type: "strong", children: [myst] };
  return { myst, text: { type: "text", text: node.text, styles }, losses };
}

function referenceHandler(node: NotebookNode, path: string): Attempt {
  const losses: Loss[] = [];
  const identity = readStoredReference(node);
  const state = scientificReferenceState(identity.reference);
  if (!identity.editorBlockId) losses.push({ path, target: "blockNote", code: "missing-editor-block-id", detail: "The editor block id is missing" });
  if (state === "missing" || state === "partial") losses.push(...both(path, "missing-object-identity", "The owner app, kind, and id are incomplete. No object id was invented."));
  else if (state === "unpinned") losses.push(...both(path, "unpinned-object-version", "The object version is empty. The editor block id was not reused as a version."));
  if (node.attrs?.snapshot != null) {
    losses.push(...both(path, "snapshot-not-in-editor-props", "The snapshot stays on the notebook node. BlockNote props and a MyST cite identifier cannot carry it."));
  }
  losses.push(...unrepresented(node, path, ["blockId", "label", "source", "snapshot"]));
  if (node.content?.length) losses.push(...both(path, "reference-content", "Reference children remain only in the stored node"));
  if (identity.reference && Object.keys(identity.reference).some(key => !["app", "kind", "id", "version", "locator"].includes(key))) losses.push(...both(path, "reference-extra-fields", "Additional owner reference fields remain only in the stored node"));
  losses.push({ path, target: "myst", code: "myst-cite-not-owner-record", detail: "MyST cite keeps one identifier string. It does not replace the owner app, kind, id, and version fields." });
  const source = identity.reference;
  const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
  if (typeof node.attrs?.label !== "string") losses.push(...both(path, "outside-subset", "Reference label is not a string"));
  const cite = {
    type: "cite",
    kind: "narrative",
    label,
    identifier: source && state === "pinned" ? (source.locator || `${source.app}/${source.kind}/${source.id}@${source.version}`) : "",
    ...(state === "pinned" ? {} : { error: "not found" }),
  };
  const block = identity.editorBlockId && source ? {
    id: identity.editorBlockId,
    type: node.type,
    props: { label, app: source.app, kind: source.kind, objectId: source.id, version: source.version, locator: source.locator },
    children: [] as [],
  } : undefined;
  return { myst: cite, block, losses };
}

function unrepresented(node: NotebookNode, path: string, represented: string[]): Loss[] {
  const extra = Object.keys(node.attrs ?? {}).filter(key => !represented.includes(key));
  const losses = extra.length ? both(path, "unrepresented-attribute", `${node.type} keeps ${extra.join(", ")} only in the stored notebook node. Replacement is refused.`) : [];
  if (node.attrs?.blockId !== undefined && !editorBlockId(node)) losses.push(...both(path, "invalid-editor-block-id", "The stored editor block id cannot be represented"));
  if (node.type !== "text" && (node.marks?.length || node.text !== undefined)) losses.push(...both(path, "unrepresented-node-fields", "Block text or marks remain only in the stored node"));
  if (node.type === "text" && node.content?.length) losses.push(...both(path, "unrepresented-node-fields", "Text children remain only in the stored node"));
  return losses;
}

function both(path: string, code: string, detail: string): Loss[] {
  return (["myst", "blockNote"] as const).map(target => ({ path, target, code, detail }));
}

function editorBlockId(node: NotebookNode): string | null {
  const id = node.attrs?.blockId;
  return typeof id === "string" && blockIdPattern.test(id) ? id : null;
}

function restoreBlock(block: BlockNoteBlock): NotebookNode {
  if (block.type === "paragraph" || block.type === "heading" || block.type === "codeBlock") return restoreProse(block);
  if (referenceTypes.has(block.type)) {
    return {
      type: block.type,
      attrs: {
        blockId: block.id,
        label: String(block.props.label),
        source: {
          app: String(block.props.app),
          kind: String(block.props.kind),
          id: String(block.props.objectId),
          version: String(block.props.version),
          locator: String(block.props.locator),
        },
        snapshot: null,
      },
    };
  }
  throw new Error(`Block type ${block.type} is outside the restore subset`);
}

function restoreProse(block: BlockNoteBlock): NotebookNode {
  const content = (block.content ?? []).map(item => {
    const marks = (["bold", "italic", "code"] as const).filter(mark => item.styles[mark]).map(type => ({ type }));
    return marks.length ? { type: "text", text: item.text, marks } : { type: "text", text: item.text };
  });
  if (block.type === "heading") return withContent({ type: "heading", attrs: { blockId: block.id, level: block.props.level } }, content);
  if (block.type === "codeBlock") {
    const attrs = typeof block.props.language === "string" ? { blockId: block.id, language: block.props.language } : { blockId: block.id };
    return withContent({ type: "codeBlock", attrs }, content);
  }
  return withContent({ type: "paragraph", attrs: { blockId: block.id } }, content);
}

function withContent(node: NotebookNode, content: NotebookNode[]): NotebookNode {
  return content.length ? { ...node, content } : node;
}

function restoreMystNode(value: unknown, path: string): NotebookNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`MyST node ${path} is not an object`);
  const node = value as { type?: string; children?: unknown; depth?: unknown; value?: unknown; lang?: unknown; data?: { editorBlockId?: unknown } };
  const blockId = typeof node.data?.editorBlockId === "string" ? node.data.editorBlockId : undefined;
  if (node.type === "paragraph" || node.type === "heading") {
    if (!Array.isArray(node.children)) throw new Error(`MyST node ${path} has no children array`);
    const content = node.children.flatMap((child, index) => restoreMystInline(child, `${path}.${index}`));
    if (node.type === "heading") {
      if (!Number.isInteger(node.depth)) throw new Error("MyST heading has no depth");
      return withContent({ type: "heading", attrs: { ...(blockId ? { blockId } : {}), level: node.depth as number } }, content);
    }
    return withContent({ type: "paragraph", ...(blockId ? { attrs: { blockId } } : {}) }, content);
  }
  if (node.type === "code" && typeof node.value === "string") {
    const attrs = { ...(blockId ? { blockId } : {}), ...(typeof node.lang === "string" ? { language: node.lang } : {}) };
    return withContent({ type: "codeBlock", ...(Object.keys(attrs).length ? { attrs } : {}) }, node.value ? [{ type: "text", text: node.value }] : []);
  }
  throw new Error(`MyST node ${String(node.type)} is outside the restore subset`);
}

function restoreMystInline(value: unknown, path: string): NotebookNode[] {
  if (!value || typeof value !== "object") throw new Error(`MyST inline ${path} is not an object`);
  const node = value as { type?: string; value?: unknown; children?: unknown[] };
  if (node.type === "text" && typeof node.value === "string") return [{ type: "text", text: node.value }];
  if (node.type === "inlineCode" && typeof node.value === "string") return [{ type: "text", text: node.value, marks: [{ type: "code" }] }];
  if ((node.type === "strong" || node.type === "emphasis") && Array.isArray(node.children)) {
    const mark = node.type === "strong" ? "bold" : "italic";
    return node.children.flatMap((child, index) => restoreMystInline(child, `${path}.${index}`)).map(restored => {
      const types = new Set([...(restored.marks ?? []).map(item => item.type), mark]);
      const marks = ["bold", "italic", "code"].filter(type => types.has(type)).map(type => ({ type }));
      return { ...restored, marks };
    });
  }
  throw new Error(`MyST inline ${String(node.type)} is outside the restore subset`);
}

interface Visit {
  node: NotebookNode;
  changed: boolean;
  errors: string[];
}

function visit(node: NotebookNode, path: string, parentType = "doc"): Visit {
  if (!node || typeof node !== "object" || typeof node.type !== "string") return { node, changed: false, errors: [`${path} is not a notebook node`] };
  if (node.type === "retainedBlock") {
    const error = retainedError(node);
    return { node, changed: false, errors: error ? [`${path} ${error}`] : [] };
  }
  if (!knownTypes.has(node.type)) return wrapUnknown(node, path, parentType);
  if (node.content === undefined) return { node, changed: false, errors: [] };
  if (!Array.isArray(node.content)) return { node, changed: false, errors: [`${path} content is not a list`] };
  let changed = false;
  const errors: string[] = [];
  const content = node.content.map((child, index) => {
    const result = visit(child, `${path}.${index}`, node.type);
    changed ||= result.changed;
    errors.push(...result.errors);
    return result.node;
  });
  if (errors.length) return { node, changed: false, errors };
  return changed ? { node: { ...node, content }, changed: true, errors } : { node, changed: false, errors };
}

const retainedParents = new Set(["doc", "blockquote", "listItem", "taskItem", "section"]);
const originalTypePattern = /^[A-Za-z][A-Za-z0-9_-]{0,64}$/;

function wrapUnknown(node: NotebookNode, path: string, parentType: string): Visit {
  const id = node.attrs?.blockId;
  if (!retainedParents.has(parentType)) {
    return { node, changed: false, errors: [`${path} ${node.type} cannot be retained inside ${parentType}, so it was left untouched`] };
  }
  if (typeof id !== "string" || !blockIdPattern.test(id)) {
    return { node, changed: false, errors: [`${path} ${node.type} has no editor block id, so it was left untouched and was not removed`] };
  }
  if (!originalTypePattern.test(node.type) || persistedBlockTypes.includes(node.type as typeof persistedBlockTypes[number])) {
    return { node, changed: false, errors: [`${path} ${node.type} cannot be stored as a retained block, so it was left untouched`] };
  }
  if (new TextEncoder().encode(JSON.stringify(node)).length > 65_536) {
    return { node, changed: false, errors: [`${path} ${node.type} is too large to retain, so it was left untouched`] };
  }
  return {
    node: { type: "retainedBlock", attrs: { blockId: id, originalType: node.type, payload: node } },
    changed: true,
    errors: [],
  };
}

function retainedError(node: NotebookNode): string | null {
  const original = node.attrs?.originalType;
  const payload = node.attrs?.payload;
  if (typeof original !== "string" || !isNode(payload) || payload.type !== original) return "retention envelope does not match its payload";
  const inner = payload.attrs?.blockId;
  if (inner !== undefined && inner !== node.attrs?.blockId) return "retention envelope id does not match its payload";
  return null;
}

function isNode(value: unknown): value is NotebookNode {
  return !!value && typeof value === "object" && typeof (value as NotebookNode).type === "string";
}
