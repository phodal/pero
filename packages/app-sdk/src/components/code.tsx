import React, {lazy, Suspense} from 'react';
import type {CodeViewerProps} from './code-viewer-engine';
import type {CodeEditorProps} from './code-editor-engine';
import type {CommandLineProps} from './command-line-engine';
export type {CommandLineProps} from './command-line-engine';
import type {CodeCompareProps} from './code-compare-engine';
import './code.css';
export type {CodeViewerProps, CodeViewerLineMark} from './code-viewer-engine';
export type {CodeEditorProps} from './code-editor-engine';
export type {CodeCompareProps, CodeCompareSide, CodeCompareBlock, CodeCompareComment} from './code-compare-engine';

const Viewer = /* @__PURE__ */ lazy(() => import('./code-viewer-engine').then(module => ({default: module.CodeViewerEngine})));
const Editor = /* @__PURE__ */ lazy(() => import('./code-editor-engine').then(module => ({default: module.CodeEditorEngine})));
const Compare = /* @__PURE__ */ lazy(() => import('./code-compare-engine').then(module => ({default: module.CodeCompareEngine})));

const Command = /* @__PURE__ */ lazy(() => import('./command-line-engine').then(module => ({default: module.CommandLineEngine})));

/** Presentation only. The App owns document identity and text; Host owns access and writes. */
export function CodeViewer(props: CodeViewerProps) {
  return <div className="pero-ui-code-viewer"><Suspense fallback={<div role="status" aria-busy="true">{props.label}</div>}><Viewer {...props}/></Suspense></div>;
}
export function CodeEditor({className, ...props}: CodeEditorProps & {className?: string}) {
  return <div className={['pero-ui-code-editor', className].filter(Boolean).join(' ')}><Suspense fallback={<div role="status" aria-busy="true">{props.label}</div>}><Editor {...props}/></Suspense></div>;
}
export function CodeCompare(props: CodeCompareProps) {
  return <div className="pero-ui-code-compare-shell"><Suspense fallback={<div role="status" aria-busy="true">{props.label}</div>}><Compare {...props}/></Suspense></div>;
}

export function CommandLine({className, ...props}: CommandLineProps & {className?: string}) {
  return <div className={['pero-ui-command-line',className].filter(Boolean).join(' ')}><Suspense fallback={<pre>{props.value}</pre>}><Command {...props}/></Suspense></div>;
}
