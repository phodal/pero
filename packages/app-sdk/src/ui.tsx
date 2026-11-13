import React, { useEffect, useMemo, useRef, useState } from 'react';
import {openDocument,standaloneDocuments,type AppDocumentInput} from './document';
import { useAppContext, useTheme } from './index';
import { mountReaderSurface } from './reader-surface';
import {contentIcons, type ContentIconInput, type ContentIconRegistry} from '../../icons/content';
import { Button } from './components/button';
import { Icon } from './components/icon';
export * from './components/index';
export { FilePicker, type FilePickerProps } from './components/input';
export { AppBar, AppFrame, PageHeader } from './components/layout';
export { Split, SplitPane, type SplitPaneProps } from './components/split';
export { Badge, ChatMarkdown, Composer, Kbd, LibraryHeader, ListRow, OutlineBadge, ReaderFrame, SearchField, SettingsGroup, SettingsRow, SidebarRow } from '../../pero-design/src/components';
export { ContentPane, ContentSection, InspectorHeader, MetadataList, contentLayout, type ContentInset, type ContentPaneProps, type ContentScroll, type ContentSectionProps, type ContentSurface, type InspectorHeaderProps, type MetadataItem, type MetadataListProps } from '../../pero-design/src/content';
export { Sidebar, SidebarGroup, WindowTitlebar } from '../../pero-design/src/shell';
export type { IconName } from './icons.generated';
export { EnvironmentBrowser, EnvironmentInspector, type ScientificMethod } from './environments';

/** Decorative content glyph; the surrounding title/action supplies the accessible name. */
export function ContentIcon({source,registry=contentIcons}:{source:ContentIconInput;registry?:ContentIconRegistry}) {
  const theme=useTheme();
  const artwork=registry.artwork({...source,dark:source.dark??theme.mode==='dark'});
  if(artwork.kind==='bundled')return <Icon name={artwork.name}/>;
  return artwork.monochrome?<span aria-hidden="true" style={{display:'inline-block',width:15,height:15,flexShrink:0,backgroundColor:'currentColor',maskImage:`url("${artwork.src}")`,maskSize:'contain',maskRepeat:'no-repeat',maskPosition:'center'}}/>:
    <img aria-hidden="true" alt="" width="15" height="15" src={artwork.src} style={{flexShrink:0}}/>;
}

function StandaloneContent({document:source}:{document:AppDocumentInput}) {
  const container=useRef<HTMLDivElement>(null),surface=useRef<ReturnType<typeof mountReaderSurface>>(null);
  const context=useAppContext();
  const reading=useMemo(()=>standaloneDocuments.admit(source),[source.id,source.title,source.text,JSON.stringify(source.format),source.location?.record]);
  useEffect(()=>{
    const mounted=mountReaderSurface(container.current!,{source:reading,context,url:'./_reader/reader.html',link:url=>window.open(url,'_blank','noopener')});
    surface.current=mounted;
    return ()=>{mounted.dispose();surface.current=null;};
  },[]);
  useEffect(()=>{surface.current?.source(reading);},[reading]);
  useEffect(()=>{surface.current?.context(context);},[context]);
  return <div ref={container} className="pero-standalone-reader"/>;
}

/** The workspace and standalone Apps use one source-backed GPUI reader. */
export function ContentView({document,labels}:{document:AppDocumentInput;labels:{open:string;source:string;opening:string}}) {
  const [opening,setOpening]=useState(false),[error,setError]=useState('');
  const hosted=window.parent!==window;
  return <div className="pero-content-view">
    {hosted ? <Button disabled={opening} onClick={()=>{setOpening(true);setError('');void openDocument(document).catch(error=>setError(error instanceof Error?error.message:String(error))).finally(()=>setOpening(false));}}><ContentIcon source={{kind:document.format.kind,language:document.format.kind==='code'?document.format.language:undefined,path:document.title}}/>{opening?labels.opening:labels.open}</Button>
      : <StandaloneContent document={document}/>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
