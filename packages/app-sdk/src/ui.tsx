import React, { createContext, useContext, useId, useState } from 'react';
import {openDocument,type AppDocumentInput} from './document';
import { iconArtwork } from './icons.generated';
import { Button, type ButtonProps } from './components/button';
export { Button, type ButtonProps } from './components/button';
export { Input, Textarea, FilePicker, type FilePickerProps } from './components/input';
export { Feedback } from './components/feedback';
export { Field, type FieldProps, type FieldControlProps } from './components/field';
export { Toolbar, PageHeader } from './components/layout';
export type { IconName } from './icons.generated';

export function IconButton({ label, ...props }: ButtonProps & { label: string }) {
  return <Button aria-label={label} title={label} {...props}/>;
}
export function Icon({ name }: { name: string }) {
  const icon = iconArtwork(name);
  return <svg {...icon.props} aria-hidden="true" width="15" height="15">{icon.children}</svg>;
}
export function Checkbox({ checked, onCheckedChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & { onCheckedChange(value: boolean): void }) {
  return <input type="checkbox" {...props} checked={checked} onChange={event => onCheckedChange(event.target.checked)} className="pero-ui-checkbox"/>;
}
export function Select({ options, label, onChange, ...props }: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & { options: { value: string; label: string }[]; label: string; onChange(value: string): void }) {
  return <select {...props} aria-label={label} onChange={event => onChange(event.target.value)} className={`pero-ui-select ${props.className ?? ''}`}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}
export function EmptyState({ heading, description }: { heading: string; description: string }) {
  return <div className="pero-ui-empty"><strong>{heading}</strong><p>{description}</p></div>;
}
export function Card({ asChild, className = '', children }: { asChild?: boolean; className?: string; children: React.ReactNode }) {
  if (asChild && React.isValidElement<{ className?: string }>(children)) return React.cloneElement(children, { className: `pero-ui-card ${className} ${children.props.className ?? ''}` });
  return <div className={`pero-ui-card ${className}`}>{children}</div>;
}
export function CardHeader({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return <header className="pero-ui-card-header">{children}{actions && <div className="pero-ui-card-actions">{actions}</div>}</header>;
}
export function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return <details className="pero-ui-disclosure"><summary>{summary}</summary><div className="pero-ui-disclosure-body">{children}</div></details>;
}

const TabContext = createContext({ value: '', change: (_value: string) => {}, id: '' });
export function Tabs({ value, onValueChange, children, className = '' }: { value: string; onValueChange(value: string): void; children: React.ReactNode; className?: string }) {
  const id = useId();
  return <TabContext.Provider value={{ value, change: onValueChange, id }}><div className={className}>{children}</div></TabContext.Provider>;
}
export function TabsList(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} role="tablist" className={`pero-ui-tabs-list ${props.className ?? ''}`} onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'));
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
  }}/>;
}
export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  const tabs = useContext(TabContext), selected = tabs.value === value;
  return <button className="pero-ui-tabs-trigger" type="button" role="tab" id={`${tabs.id}-${value}-tab`} aria-controls={`${tabs.id}-${value}-panel`} aria-selected={selected} tabIndex={selected ? 0 : -1} onClick={() => tabs.change(value)}>{children}</button>;
}
export function TabsContent({ value, forceMount, children }: { value: string; forceMount?: boolean; children: React.ReactNode }) {
  const tabs = useContext(TabContext), selected = tabs.value === value;
  return selected || forceMount ? <section className="pero-ui-tabs-content" role="tabpanel" id={`${tabs.id}-${value}-panel`} aria-labelledby={`${tabs.id}-${value}-tab`} hidden={!selected}>{children}</section> : null;
}
export function ResultView({ result, labels, className = '' }: { result: { title: string; columns: string[]; rows: (string | number | null)[][]; provenance: { label: string } }; labels: { source: string; empty?: string; provenance?: Record<string, string> }; className?: string }) {
  return <section className={`pero-ui-result ${className}`} aria-label={result.title}><h3>{result.title}</h3><div className="pero-ui-table-scroll" tabIndex={0}><table><thead><tr>{result.columns.map((column, i) => <th key={i} scope="col">{column}</th>)}</tr></thead><tbody>{result.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{typeof cell === 'number' ? cell.toLocaleString(undefined, { maximumFractionDigits: 5 }) : cell ?? '—'}</td>)}</tr>)}</tbody></table></div>{!result.rows.length && <p>{labels.empty}</p>}<p className="pero-ui-result-source">{labels.source}: {result.provenance.label}</p></section>;
}

/** Full source access. Hosted Apps use the shared workspace reader; standalone Apps retain exact text. */
export function ContentView({document,labels}:{document:AppDocumentInput;labels:{open:string;source:string;opening:string}}) {
  const [opening,setOpening]=useState(false),[error,setError]=useState('');
  const hosted=window.parent!==window;
  return <div className="pero-content-view">
    {hosted ? <Button disabled={opening} onClick={()=>{setOpening(true);setError('');void openDocument(document).catch(error=>setError(error instanceof Error?error.message:String(error))).finally(()=>setOpening(false));}}>{opening?labels.opening:labels.open}</Button>
      : <textarea aria-label={labels.source} readOnly value={document.text} spellCheck={false} className="pero-content-source"/>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
