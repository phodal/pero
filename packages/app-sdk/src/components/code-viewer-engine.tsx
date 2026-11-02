// Adapted from Point App SDK (Apache-2.0), source revision 872cbf87d.
import React, {useEffect,useRef} from 'react';
import {EditorState,StateEffect,StateField} from '@codemirror/state';
import {EditorView,Decoration,keymap,lineNumbers,highlightActiveLine,drawSelection} from '@codemirror/view';
import {LRLanguage,StreamLanguage,HighlightStyle,syntaxHighlighting,foldService,foldGutter,foldKeymap,type StreamParser} from '@codemirror/language';
import {searchKeymap} from '@codemirror/search';
import {defaultKeymap} from '@codemirror/commands';
import {tags} from '@lezer/highlight';
import {parser as javascriptParser} from '@lezer/javascript';
import {cobol} from '@codemirror/legacy-modes/mode/cobol';
import {java} from '@codemirror/legacy-modes/mode/clike';
import {css} from '@codemirror/legacy-modes/mode/css';
import {pgSQL} from '@codemirror/legacy-modes/mode/sql';
import {html} from '@codemirror/legacy-modes/mode/xml';

/** JSON keys and values stay distinct. The legacy JavaScript mode marks keys as "string property", which is not a highlight tag. */
const jsonParser: StreamParser<{stack: string[]}>={
  startState:()=>({stack:['array'] as string[]}),
  token(stream, state){
    if(stream.eatSpace()) return null;
    const top=state.stack.length-1;
    const here=state.stack[top];
    const ch=stream.peek();
    if(ch==='{'){stream.next();state.stack.push('object-key');return 'bracket';}
    if(ch==='['){stream.next();state.stack.push('array');return 'bracket';}
    if(ch==='}'||ch===']'){stream.next();state.stack.pop();return 'bracket';}
    if(ch===','){stream.next();if(here==='object-value') state.stack[top]='object-key';return 'punctuation';}
    if(ch===':'){stream.next();if(here==='object-key') state.stack[top]='object-value';return 'punctuation';}
    if(ch==='"'){
      stream.next();
      let escaped=false;
      while(!stream.eol()){
        const next=stream.next();
        if(escaped){escaped=false;continue;}
        if(next==='\\'){escaped=true;continue;}
        if(next==='"') break;
      }
      return here==='object-key'?'propertyName':'string';
    }
    if(stream.match(/^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/)) return 'number';
    if(stream.match(/^(?:true|false|null)\b/)) return 'atom';
    stream.next();
    return null;
  },
};

export type CodeViewerLineMark = { startLine: number; endLine: number; className: string };

const highlight=StateEffect.define<number>();
const selectedLine=StateField.define({create:()=>Decoration.none,update:(value,tr)=>{value=value.map(tr.changes);for(const effect of tr.effects)if(effect.is(highlight)){value=effect.value>=1&&effect.value<=tr.state.doc.lines?Decoration.set([Decoration.line({class:'pero-source-selected'}).range(tr.state.doc.line(effect.value).from)]):Decoration.none;}return value;},provide:field=>EditorView.decorations.from(field)});

const setLineMarks=StateEffect.define<{marks:CodeViewerLineMark[];startLine:number}>();
function decorationsForMarks(doc:{lines:number;line:(n:number)=>{from:number}},marks:CodeViewerLineMark[],startLine:number){
  const ranges=[];
  for(const mark of marks){
    for(let absolute=mark.startLine;absolute<=mark.endLine;absolute++){
      const index=absolute-startLine+1;
      if(index<1||index>doc.lines)continue;
      ranges.push(Decoration.line({class:mark.className}).range(doc.line(index).from));
    }
  }
  return Decoration.set(ranges,true);
}
const markedLines=StateField.define({create:()=>Decoration.none,update:(value,tr)=>{for(const effect of tr.effects)if(effect.is(setLineMarks))return decorationsForMarks(tr.state.doc,effect.value.marks,effect.value.startLine);return value.map(tr.changes);},provide:field=>EditorView.decorations.from(field)});

const accent='var(--pero-source-accent, var(--pero-action))';
const literal='var(--pero-source-literal, var(--pero-success))';
const muted='var(--pero-source-muted, var(--pero-text-muted))';
const warning='var(--pero-warning, var(--pero-action))';
/** The legacy JavaScript mode has no JSX. Lezer covers JS, TS and React tags. */
const javascriptLanguage=LRLanguage.define({name:'javascript',parser:javascriptParser});
const typescriptLanguage=javascriptLanguage.configure({dialect:'ts'},'typescript');
const jsxLanguage=javascriptLanguage.configure({dialect:'jsx'},'jsx');
const tsxLanguage=javascriptLanguage.configure({dialect:'jsx ts'},'tsx');
function highlightFor(language:string){
  const rules=[{tag:tags.keyword,color:accent},{tag:[tags.string,tags.number],color:literal},{tag:tags.comment,color:muted}];
  if(language==='sql'||language==='json'||language==='jcl') rules.push({tag:[tags.propertyName,tags.attributeName],color:accent},{tag:[tags.typeName,tags.atom],color:warning});
  if(language==='jcl') rules.push({tag:tags.meta,color:muted});
  if(language==='javascript'||language==='typescript'||language==='jsx'||language==='tsx') rules.push({tag:[tags.tagName,tags.typeName],color:warning},{tag:tags.attributeName,color:accent},{tag:tags.angleBracket,color:muted});
  if(language==='css'||language==='html') rules.push({tag:tags.tagName,color:warning},{tag:[tags.propertyName,tags.attributeName],color:accent},{tag:tags.angleBracket,color:muted});
  return syntaxHighlighting(HighlightStyle.define(rules));
}
/** JCL, IMS PSB/DBD and CICS BMS share one macro-style layout: a label, a macro/op name, then KEYWORD=value operands. */
const mvsKeywords=new Set(['JOB','EXEC','DD','PROC','PEND','SET','IF','THEN','ELSE','ENDIF','INCLUDE','OUTPUT','PCB','SENSEG','SEGM','FIELD','LCHILD','DATASET','DBD','DBDGEN','PSBGEN','FINISH','END','PRINT','NOGEN','TITLE','DFHMSD','DFHMDI','DFHMDF','COPY']);
const mvsMacro: StreamParser<Record<string, never>>={
  startState:()=>({}),
  token(stream){
    if(stream.sol()&&(stream.match(/^\/\/\*/)||stream.peek()==='*')){stream.skipToEnd();return 'comment';}
    if(stream.sol()&&stream.match(/^\/\//)) return 'meta';
    if(stream.eatSpace()) return null;
    if(stream.peek()==='\''){
      stream.next();
      while(!stream.eol()){const ch=stream.next();if(ch==='\''){if(stream.peek()==='\'')stream.next();else break;}}
      return 'string';
    }
    if(stream.match(/^[A-Za-z0-9$#@-]+(?==)/)) return 'propertyName';
    if(stream.match(/^[0-9]+\b/)) return 'number';
    if(stream.match(/^[A-Za-z$#@][A-Za-z0-9$#@-]*/)){
      const word=stream.current().toUpperCase();
      return mvsKeywords.has(word)?'keyword':null;
    }
    stream.next();
    return null;
  },
};
type SqlState = {tokenize: unknown};
const sqlMode = pgSQL as StreamParser<SqlState>;
const sqlBase=sqlMode.startState!(2).tokenize;
/** PostgreSQL mode leaves double-quoted identifiers unstyled. They are the names in generated DDL. */
const sqlParser: StreamParser<SqlState>={...sqlMode,token(stream,state){
  if(stream.peek()==='"'&&state.tokenize===sqlBase){
    stream.next();
    while(!stream.eol()){
      const ch=stream.next();
      if(ch==='"'){if(stream.peek()==='"') stream.next();else break;}
    }
    return 'string';
  }
  return sqlMode.token(stream,state);
}};
function languageExtension(language:string){
  if(language==='javascript') return javascriptLanguage;
  if(language==='typescript') return typescriptLanguage;
  if(language==='jsx') return jsxLanguage;
  if(language==='tsx') return tsxLanguage;
  if(language==='java') return StreamLanguage.define(java);
  if(language==='sql') return StreamLanguage.define(sqlParser);
  if(language==='json') return StreamLanguage.define(jsonParser);
  if(language==='css') return StreamLanguage.define(css);
  if(language==='html') return StreamLanguage.define(html);
  if(language==='jcl') return StreamLanguage.define(mvsMacro);
  return StreamLanguage.define(cobol);
}

export type CodeViewerProps = {
  text: string;
  documentId: string;
  language?: 'cobol' | 'java' | 'sql' | 'jcl' | 'json' | 'javascript' | 'typescript' | 'jsx' | 'tsx' | 'css' | 'html' | 'plain';
  /** Soft-wrap long lines. COBOL and Java viewers stay unwrapped. */
  wrap?: boolean;
  startLine?: number;
  line?: number;
  ranges?: { startLine: number; endLine: number }[];
  /** Absolute 1-based line ranges; classes are applied to CodeMirror `.cm-line` nodes. */
  lineMarks?: CodeViewerLineMark[];
  label: string;
  phrases?: Record<string, string>;
  onCursor?: (line: number) => void;
  className?: string;
};

/** Presentation only. Outer coordinator owns immutable document identity, IO and navigation history. */
export function CodeViewerEngine({text,documentId,language='cobol',wrap=false,startLine=1,line=1,ranges=[],lineMarks=[],label,phrases={},onCursor,className}:CodeViewerProps) {
  const phraseKey=JSON.stringify(phrases);
  const marksKey=JSON.stringify(lineMarks);
  const holder=useRef<HTMLDivElement>(null),editor=useRef<EditorView|null>(null),cursor=useRef(onCursor),foldRanges=useRef(ranges);cursor.current=onCursor;foldRanges.current=ranges;
  useEffect(()=>{
    if(!holder.current)return;
    const state=EditorState.create({doc:text,extensions:[EditorState.readOnly.of(true),EditorState.phrases.of(phrases),EditorView.editable.of(false),EditorView.contentAttributes.of({'aria-label':label,'aria-readonly':'true',tabindex:'0'}),lineNumbers({formatNumber:n=>String(n+startLine-1)}),...(language === 'plain' ? [] : [languageExtension(language)]),highlightFor(language),...(wrap?[EditorView.lineWrapping]:[]),foldGutter(),foldService.of((state,from)=>{const absolute=state.doc.lineAt(from).number+startLine-1;const range=foldRanges.current.filter((r:any)=>r.startLine===absolute&&r.endLine>absolute&&r.endLine-startLine<state.doc.lines).sort((a:any,b:any)=>a.endLine-b.endLine)[0];return range?{from:state.doc.lineAt(from).to,to:state.doc.line(range.endLine-startLine+1).to}:null;}),keymap.of([...searchKeymap,...foldKeymap,...defaultKeymap]),drawSelection(),highlightActiveLine(),selectedLine,markedLines,EditorView.updateListener.of(update=>{if(update.selectionSet)cursor.current?.(update.state.doc.lineAt(update.state.selection.main.head).number+startLine-1);}),EditorView.theme({'&':{height:'100%',minHeight:'150px',backgroundColor:'var(--pero-source-background, var(--pero-surface))',color:'var(--pero-source-foreground, var(--pero-text))'},'.cm-scroller':{height:'100%',minHeight:'0',fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace',fontSize:'12px',overflow:'auto'},'.cm-content':{padding:'10px 0'},'.cm-gutters':{backgroundColor:'var(--pero-source-gutter, var(--pero-surface-muted))',color:'var(--pero-source-muted, var(--pero-text-muted))',borderRight:'1px solid var(--pero-source-border, var(--pero-border))'},'.cm-activeLine,.pero-source-selected':{backgroundColor:'var(--pero-source-selection, var(--pero-fill-hover))'},'&.cm-focused':{outline:'2px solid var(--pero-source-accent, var(--pero-action))',outlineOffset:'-2px'},'.cm-cursor':{borderLeftColor:'var(--pero-source-foreground, var(--pero-text))'},'.cm-panel':{backgroundColor:'var(--pero-source-gutter, var(--pero-surface-muted))',color:'var(--pero-source-foreground, var(--pero-text))'},'.cm-searchMatch':{backgroundColor:'var(--pero-source-selection, var(--pero-fill-hover))',outline:'1px solid var(--pero-source-accent, var(--pero-action))'},'.cm-lineWrapping':{overflowWrap:'anywhere'}})]});
    const view=new EditorView({state,parent:holder.current});editor.current=view;
    view.dispatch({effects:setLineMarks.of({marks:lineMarks,startLine})});
    return ()=>{editor.current=null;view.destroy();};
  },[text,documentId,language,wrap,startLine,phraseKey,label]);
  useEffect(()=>{const view=editor.current;if(!view)return;view.dispatch({effects:setLineMarks.of({marks:lineMarks,startLine})});},[marksKey,startLine,text,documentId,language,phraseKey,label]);
  useEffect(()=>{const view=editor.current,index=line-startLine+1;if(!view||index<1||index>view.state.doc.lines)return;const from=view.state.doc.line(index).from;view.dispatch({selection:{anchor:from},effects:[highlight.of(index),EditorView.scrollIntoView(from,{y:'center'})]});},[line,text,documentId,language,startLine,phraseKey]);
  return <div className={["pero-source-pane",className].filter(Boolean).join(" ")} ref={holder} data-document={documentId}/>;
}
