/** Compatibility for the migrated feature; shared behavior remains in Pero's SDK. */
import React from 'react';
import { Button as HostButton, Toolbar as HostToolbar, Feedback as HostFeedback, Icon as HostIcon } from '@pero/app-sdk/ui';
export { Input, Textarea, Field, Select, Checkbox, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
export type ShellIconName = string;
export type UiIconName = string;

export function Button({ variant, unstyled: _, ...props }: Omit<React.ComponentProps<typeof HostButton>, 'variant'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'unstyled'; unstyled?: boolean }) {
  return <HostButton {...props} variant={variant === 'unstyled' ? 'ghost' : variant}/>;
}
export function Toolbar({ unstyled: _, ...props }: React.ComponentProps<typeof HostToolbar> & { unstyled?: boolean }) { return <HostToolbar {...props}/>; }
export function Feedback({ kind, unstyled: _, ...props }: Omit<React.ComponentProps<typeof HostFeedback>, 'kind'> & { kind?: 'status' | 'error'; unstyled?: boolean }) {
  return <HostFeedback {...props} kind={kind === 'error' ? 'error' : undefined}/>;
}
export function EmptyState({ as: Component = 'div', unstyled: _, ...props }: React.HTMLAttributes<HTMLElement> & { as?: 'p' | 'div'; unstyled?: boolean }) { return <Component {...props}/>; }
export function Icon({ name = 'link', glyph, size = 15, ...props }: { name?: string; family?: string; size?: number; glyph?: { viewBox: string; children: React.ReactNode }; stroke?: string; style?: React.CSSProperties }) {
  return glyph ? <svg aria-hidden="true" width={size} height={size} viewBox={glyph.viewBox} {...props}>{glyph.children}</svg> : <HostIcon name={name}/>;
}
export function InfoTip({ label, text, align = 'start' }: { label: string; text: React.ReactNode; align?: 'start' | 'end' }) {
  const id = React.useId();
  return <span className="connector-info" data-align={align}><button type="button" aria-label={label} aria-describedby={id}>ⓘ</button><span id={id} role="tooltip">{text}</span></span>;
}
