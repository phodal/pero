import React, { createContext, useContext, useId } from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' };
export function Button({ className = '', variant = 'secondary', ...props }: ButtonProps) {
  return <button type="button" {...props} className={`pero-ui-button ${variant} ${className}`}/>;
}
export function IconButton({ label, ...props }: ButtonProps & { label: string }) {
  return <Button aria-label={label} title={label} {...props}/>;
}
const icons: Record<string, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14"/>, minus: <path d="M5 12h14"/>,
  refresh: <><path d="M20 7v5h-5"/><path d="M4 17a8 8 0 0 0 14 1M20 7A8 8 0 0 0 6 6L4 9"/></>,
  play: <path d="m8 5 11 7-11 7Z"/>, fit: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"/>,
  nodes: <><circle cx="5" cy="12" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><path d="m8 11 8-5M8 13l8 5"/></>,
  app: <><circle cx="12" cy="12" r="9"/><circle cx="10" cy="10" r="3"/><path d="m17 15-2 2"/></>,
  models: <><path d="m12 3 9 5v8l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/></>,
};
export function Icon({ name, family: _family }: { name: string; family?: string }) {
  return <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icons[name] ?? icons.app}</svg>;
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`pero-ui-input ${props.className ?? ''}`}/>;
}
export function Checkbox({ checked, onCheckedChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & { onCheckedChange(value: boolean): void }) {
  return <input type="checkbox" {...props} checked={checked} onChange={event => onCheckedChange(event.target.checked)} className="pero-ui-checkbox"/>;
}
export function Select({ options, label, onChange, ...props }: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & { options: { value: string; label: string }[]; label: string; onChange(value: string): void }) {
  return <select {...props} aria-label={label} onChange={event => onChange(event.target.value)} className={`pero-ui-select ${props.className ?? ''}`}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}
export function Field({ label, children }: { label: string; children: (props: { id: string }) => React.ReactNode }) {
  const id = useId();
  return <div className="pero-ui-field"><label htmlFor={id}>{label}</label>{children({ id })}</div>;
}
export function Feedback({ kind, children }: { kind?: 'error'; children: React.ReactNode }) {
  return <div className={`pero-ui-feedback ${kind ?? ''}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
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
export function Toolbar({ children, actions, className = '' }: { children?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return <div className={`pero-ui-toolbar ${className}`}>{children}{actions && <div className="pero-ui-toolbar-actions">{actions}</div>}</div>;
}

const TabContext = createContext({ value: '', change: (_value: string) => {}, id: '' });
export function Tabs({ value, onValueChange, children, className = '' }: { value: string; onValueChange(value: string): void; children: React.ReactNode; className?: string }) {
  const id = useId();
  return <TabContext.Provider value={{ value, change: onValueChange, id }}><div className={className}>{children}</div></TabContext.Provider>;
}
export function TabsList(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} role="tablist" className="pero-ui-tabs-list" onKeyDown={event => {
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
