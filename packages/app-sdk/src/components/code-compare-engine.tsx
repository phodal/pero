// Adapted from Point App SDK (Apache-2.0), source revision 872cbf87d.
import React, { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { defaultKeymap } from '@codemirror/commands';
import { MergeView } from '@codemirror/merge';
import {Split, SplitPane} from './split';
import '../ui.css';
import { tags } from '@lezer/highlight';
import { cobol } from '@codemirror/legacy-modes/mode/cobol';
import { mappedCompareLine, mappedCompareBlock } from './code-compare-blocks.mjs';
import { java } from '@codemirror/legacy-modes/mode/clike';

export type CodeCompareSide = {
  text: string;
  documentId: string;
  language?: 'cobol' | 'java' | 'plain';
  startLine?: number;
  line?: number;
  label: string;
};

const highlight = StateEffect.define<number>();
const selectedLine = StateField.define({
  create: () => Decoration.none,
  update: (value, tr) => {
    value = value.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(highlight)) {
      value = effect.value >= 1 && effect.value <= tr.state.doc.lines
        ? Decoration.set([Decoration.line({ class: 'pero-source-selected' }).range(tr.state.doc.line(effect.value).from)])
        : Decoration.none;
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

const activeBlockEffect = StateEffect.define<{ start: number; end: number } | null>();
const activeBlockLines = StateField.define({
  create: () => Decoration.none,
  update: (value, transaction) => {
    for (const effect of transaction.effects) if (effect.is(activeBlockEffect)) {
      if (!effect.value) return Decoration.none;
      const {start,end}=effect.value;
      const marks=[];
      for(let line=Math.max(1,start);line<=Math.min(end,transaction.state.doc.lines);line++) marks.push(Decoration.line({class:'pero-compare-block-active'}).range(transaction.state.doc.line(line).from));
      return Decoration.set(marks);
    }
    return value.map(transaction.changes);
  },
  provide: field => EditorView.decorations.from(field),
});

class CompareCommentWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  toDOM() {
    const node = document.createElement('div');
    node.className = 'pero-compare-comment-body';
    node.textContent = this.text;
    return node;
  }
  eq(other: CompareCommentWidget) { return other.text === this.text; }
  ignoreEvent() { return true; }
}

const commentsEffect = StateEffect.define<Array<{ line: number; text: string }>>();
const commentMarks = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(commentsEffect)) {
      const marks = [];
      for (const item of effect.value) {
        if (item.line < 1 || item.line > transaction.state.doc.lines) continue;
        const line = transaction.state.doc.line(item.line);
        marks.push(Decoration.line({ class: 'pero-compare-comment' }).range(line.from));
        marks.push(Decoration.widget({ widget: new CompareCommentWidget(item.text), block: true, side: 1 }).range(line.to));
      }
      return Decoration.set(marks, true);
    }
    return value.map(transaction.changes);
  },
  provide: field => EditorView.decorations.from(field),
});

function commentRanges(comments: CodeCompareComment[] | undefined, side: 'left' | 'right', startLine: number, lines: number) {
  const grouped = new Map<number, string[]>();
  for (const comment of comments ?? []) {
    if (comment.side !== side) continue;
    const index = comment.line - startLine + 1;
    if (index < 1 || index > lines) continue;
    const notes = grouped.get(index) ?? [];
    notes.push(comment.text);
    grouped.set(index, notes);
  }
  return [...grouped.entries()].map(([line, notes]) => ({ line, text: notes.join('\n') }));
}

const colors = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--pero-source-accent, var(--pero-action))' },
  { tag: [tags.string, tags.number], color: 'var(--pero-source-literal, var(--pero-success))' },
  { tag: tags.comment, color: 'var(--pero-source-muted, var(--pero-text-muted))' },
]);

const paneTheme = EditorView.theme({
  '&': {
    height: '100%',
    minHeight: '150px',
    backgroundColor: 'var(--pero-source-background, var(--pero-surface))',
    color: 'var(--pero-source-foreground, var(--pero-text))',
  },
  '.cm-scroller': {
    height: '100%',
    minHeight: '0',
    fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
    fontSize: '12px',
    overflow: 'auto',
  },
  '.cm-content': { padding: '10px 0' },
  '.cm-gutters': {
    backgroundColor: 'var(--pero-source-gutter, var(--pero-surface-muted))',
    color: 'var(--pero-source-muted, var(--pero-text-muted))',
    borderRight: '1px solid var(--pero-source-border, var(--pero-border))',
  },
  '.cm-activeLine,.pero-source-selected': { backgroundColor: 'var(--pero-source-selection, var(--pero-fill-hover))' },
  '&.cm-focused': {
    outline: '2px solid var(--pero-source-accent, var(--pero-action))',
    outlineOffset: '-2px',
  },
  '.cm-cursor': { borderLeftColor: 'var(--pero-source-foreground, var(--pero-text))' },
  '.cm-panel': {
    backgroundColor: 'var(--pero-source-gutter, var(--pero-surface-muted))',
    color: 'var(--pero-source-foreground, var(--pero-text))',
  },
  '.pero-compare-block-active': { backgroundColor: 'var(--pero-source-selection, var(--pero-fill-hover))', boxShadow: 'inset 2px 0 var(--pero-source-accent, var(--pero-action))' },
  '.pero-compare-comment': { backgroundColor: 'var(--pero-source-selection, var(--pero-fill-hover))', boxShadow: 'inset 2px 0 var(--pero-warning, var(--pero-action))' },
  '.pero-compare-comment-body': {
    margin: '2px 12px 8px',
    padding: '4px 8px',
    borderInlineStart: '2px solid var(--pero-warning, var(--pero-action))',
    color: 'var(--pero-source-foreground, var(--pero-text))',
    whiteSpace: 'pre-wrap',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--pero-source-selection, var(--pero-fill-hover))',
    outline: '1px solid var(--pero-source-accent, var(--pero-action))',
  },
});

function languageExt(language: CodeCompareSide['language']) {
  if (language === 'plain') return [];
  return [StreamLanguage.define(language === 'java' ? java : cobol)];
}

function editorExtensions(side: CodeCompareSide, phrases: Record<string, string>, highlightDifferences: boolean) {
  const startLine = side.startLine ?? 1;
  return [
    EditorState.readOnly.of(true),
    EditorState.phrases.of(phrases),
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({ 'aria-label': side.label, 'aria-readonly': 'true', tabindex: '0' }),
    lineNumbers({ formatNumber: n => String(n + startLine - 1) }),
    ...languageExt(side.language),
    syntaxHighlighting(colors),
    keymap.of([...searchKeymap, ...defaultKeymap]),
    drawSelection(),
    highlightActiveLine(),
    selectedLine,
    commentMarks,
    paneTheme,
    ...(!highlightDifferences ? [EditorView.theme({ '&.cm-merge-a .cm-changedLine, &.cm-merge-b .cm-changedLine': { backgroundColor: 'transparent' } })] : []),
  ];
}

function scrollToLine(view: EditorView | null, line: number | undefined, startLine: number) {
  if (!view || !line) return;
  const index = line - startLine + 1;
  if (index < 1 || index > view.state.doc.lines) return;
  const from = view.state.doc.line(index).from;
  view.dispatch({
    selection: { anchor: from },
    effects: [highlight.of(index), EditorView.scrollIntoView(from, { y: 'center' })],
  });
}

export type CodeCompareBlock = { left: { startLine: number; endLine: number }; right: { startLine: number; endLine: number } };

export type CodeCompareComment = { side: 'left' | 'right'; line: number; text: string };

export type CodeCompareProps = {
  left: CodeCompareSide;
  right: CodeCompareSide;
  label: string;
  phrases?: Record<string, string>;
  /** Keep alignment and shared scrolling without insert/delete marks for different languages. */
  highlightDifferences?: boolean;
  /** Explicit source/target blocks. An empty array keeps both sides independently browsable. */
  blocks?: CodeCompareBlock[];
  /** Current mapped block index, or null outside mapped ranges. */
  onActiveBlockChange?: (index: number | null) => void;
  /** Mapped blocks follow the other side while this stays true. */
  syncScroll?: boolean;
  /** Review notes drawn on a side. Callers own the text. */
  comments?: CodeCompareComment[];
  className?: string;
};

/** Side-by-side CodeMirror merge view for read-only comparison. Callers own text, identity and IO. */
export function CodeCompareEngine({ left, right, label, phrases = {}, highlightDifferences = true, blocks, onActiveBlockChange, syncScroll = true, comments, className }: CodeCompareProps) {
  const holder = useRef<HTMLDivElement>(null);
  const merge = useRef<MergeView | null>(null);
  const editors = useRef<{a:EditorView;b:EditorView}|null>(null);
  const activeCallback=useRef(onActiveBlockChange);activeCallback.current=onActiveBlockChange;
  const syncScrollRef = useRef(syncScroll); syncScrollRef.current = syncScroll;
  const leftHost = useRef<HTMLDivElement>(null), rightHost = useRef<HTMLDivElement>(null);
  const blocksKey = JSON.stringify(blocks);
  const phraseKey = JSON.stringify(phrases);
  const leftKey = `${left.documentId}\0${left.text}`;
  const rightKey = `${right.documentId}\0${right.text}`;
  const editorKey = JSON.stringify([leftKey, rightKey, phraseKey, highlightDifferences, blocksKey, left.label, left.language, left.startLine, right.label, right.language, right.startLine, label]);

  useEffect(() => {
    if (blocks ? !leftHost.current || !rightHost.current : !holder.current) return;
    if (blocks) {
      const user={left:false,right:false},lastTop={left:0,right:0};
      let active: CodeCompareBlock | null | undefined;
      let alive=true,followRevision=0;
      const activate=(block:CodeCompareBlock|null)=>{
        if(active===block)return;active=block;
        const pair=editors.current;if(!pair)return;
        for(const [view,side,offset] of [[pair.a,'left',left.startLine??1],[pair.b,'right',right.startLine??1]] as const){
          view.dispatch({effects:activeBlockEffect.of(block?{start:block[side].startLine-offset+1,end:block[side].endLine-offset+1}:null)});
        }
        activeCallback.current?.(block?blocks.indexOf(block):null);
      };
      const follow=(side:'left'|'right',line:number)=>{
        activate(mappedCompareBlock(blocks,side,line));
        const target=mappedCompareLine(blocks,side,line),other=side==='left'?'right':'left';
        const destination=side==='left'?editors.current?.b:editors.current?.a;
        const offset=(side==='left'?right.startLine:left.startLine)??1;
        if(target===null||!destination||target-offset+1<1||target-offset+1>destination.state.doc.lines)return;
        user[other]=false;
        destination.dispatch({effects:EditorView.scrollIntoView(destination.state.doc.line(target-offset+1).from,{y:'start'})});
      };
      // CodeMirror disallows dispatch during its update/measurement phase.
      const scheduleFollow=(side:'left'|'right',line:number)=>{
        const revision=++followRevision;
        queueMicrotask(()=>{if(alive&&revision===followRevision&&user[side]&&syncScrollRef.current)follow(side,line);});
      };
      const makeSide=(side:'left'|'right',document:CodeCompareSide)=>{
        const parent=(side==='left'?leftHost:rightHost).current!;
        return new EditorView({parent,state:EditorState.create({doc:document.text,extensions:[...editorExtensions(document,phrases,false),activeBlockLines,EditorView.updateListener.of(update=>{if(update.selectionSet&&user[side])scheduleFollow(side,update.state.doc.lineAt(update.state.selection.main.head).number+(document.startLine??1)-1);}),EditorView.domEventHandlers({
          wheel:()=>{user[side]=true;},pointerdown:()=>{user[side]=true;},touchstart:()=>{user[side]=true;},keydown:()=>{user[side]=true;},
          scroll:(event,view)=>{
            if(event.target!==view.scrollDOM)return;
            const top=view.scrollDOM.scrollTop,changed=top!==lastTop[side];lastTop[side]=top;
            if(!user[side]||!changed)return;
            view.requestMeasure({read:v=>v.state.doc.lineAt(v.lineBlockAtHeight(v.scrollDOM.scrollTop).from).number+(document.startLine??1)-1,write:line=>{
              if(!user[side])return;
              scheduleFollow(side,line);
            }});
          },
        })]})});
      };
      const a=makeSide('left',left),b=makeSide('right',right);editors.current={a,b};activate(blocks[0]??null);
      for(const [view,line,start] of [[a,left.line??blocks[0]?.left.startLine,left.startLine??1],[b,right.line??blocks[0]?.right.startLine,right.startLine??1]] as const){const index=(line??0)-start+1;if(index>=1&&index<=view.state.doc.lines){const anchor=view.state.doc.line(index).from;view.dispatch({selection:{anchor},effects:EditorView.scrollIntoView(anchor,{y:'start'})});}}
      return ()=>{alive=false;followRevision++;editors.current=null;a.destroy();b.destroy();};
    }
    activeCallback.current?.(null);
    const view = new MergeView({
      parent: holder.current!,
      a: { doc: left.text, extensions: editorExtensions(left, phrases, highlightDifferences) },
      b: { doc: right.text, extensions: editorExtensions(right, phrases, highlightDifferences) },
      highlightChanges: highlightDifferences,
      gutter: highlightDifferences,
      collapseUnchanged: highlightDifferences ? { margin: 4, minSize: 10 } : undefined,
      diffConfig: { scanLimit: 800, timeout: 120 },
    });
    merge.current = view;editors.current=view;
    scrollToLine(view.a, left.line, left.startLine ?? 1);
    scrollToLine(view.b, right.line, right.startLine ?? 1);
    return () => { merge.current = null; editors.current=null; view.destroy(); };
  }, [editorKey]);

  useEffect(() => {
    scrollToLine(editors.current?.a ?? null, left.line, left.startLine ?? 1);
  }, [left.line, left.startLine, editorKey]);

  useEffect(() => {
    scrollToLine(editors.current?.b ?? null, right.line, right.startLine ?? 1);
  }, [right.line, right.startLine, editorKey]);

  const commentsKey = JSON.stringify(comments ?? []);
  useEffect(() => {
    const pair = editors.current;
    if (!pair) return;
    pair.a.dispatch({ effects: commentsEffect.of(commentRanges(comments, 'left', left.startLine ?? 1, pair.a.state.doc.lines)) });
    pair.b.dispatch({ effects: commentsEffect.of(commentRanges(comments, 'right', right.startLine ?? 1, pair.b.state.doc.lines)) });
  }, [commentsKey, editorKey]);

  return (
    <div
      className={['pero-ui-code-compare', className].filter(Boolean).join(' ')}
      ref={blocks ? undefined : holder}
      role="region"
      aria-label={label}
      data-left={left.documentId}
      data-right={right.documentId}
      data-sync-scroll={syncScroll ? 'true' : 'false'}
    >{blocks && <Split collapseBelow={640}>
      <SplitPane id="code-left" size={450} min={160} resizeLabel={label}><div ref={leftHost} className="pero-code-compare-pane"/></SplitPane>
      <SplitPane id="code-right" min={160}><div ref={rightHost} className="pero-code-compare-pane"/></SplitPane>
    </Split>}</div>
  );
}
