// Adapted from Point App SDK d95f9118e (Apache-2.0).
import { iconArtwork } from '../icons.generated';
import React, { forwardRef } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { shellIcons, uiIcons } from './icon-lucide';
import type { ShellIconName, UiIconName } from './icon-lucide';

export type { ShellIconName, UiIconName };

/** Caller-supplied artwork. `children` is the SVG interior, not Icon children. */
export type IconGlyph = {
  viewBox: string;
  children: ReactNode;
  strokeWidth?: number | string;
};

type IconSvgProps = Omit<React.ComponentPropsWithoutRef<'svg'>, 'children'>;

type IconBase = IconSvgProps & {
  /** Accessible name. Omit for a decorative icon. */
  label?: string;
  /** Default width and height. Native `width` / `height` win when set. */
  size?: number | string;
};

export type IconProps =
  | (IconBase & { family?: 'ui'; name: UiIconName | (string & {}); fallbackName?: UiIconName; glyph?: never })
  | (IconBase & { family: 'shell'; name: ShellIconName; fallbackName?: ShellIconName; glyph?: never })
  | (IconBase & { glyph: IconGlyph; name?: never; family?: never; fallbackName?: never });

type ResolvedProps = IconSvgProps & {
  family?: 'ui' | 'shell';
  name?: string;
  fallbackName?: string;
  glyph?: IconGlyph;
  label?: string;
  size?: number | string;
  children?: ReactNode;
};

function ownIcon(table: object, key: unknown) {
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(table, key)) return undefined;
  return (table as Record<string, LucideIcon>)[key];
}

/** Which shared family owns a manifest icon name. A path is not a name. */
export function iconFamily(name: unknown): 'ui' | 'shell' | null {
  if (ownIcon(uiIcons, name)) return 'ui';
  if (ownIcon(shellIcons, name)) return 'shell';
  return null;
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(props, ref) {
  const {
    family,
    name,
    fallbackName,
    glyph,
    label,
    size,
    className,
    width,
    height,
    viewBox,
    fill,
    stroke,
    strokeWidth,
    strokeLinecap,
    strokeLinejoin,
    focusable,
    children: _children,
    role: _role,
    'aria-hidden': _ariaHidden,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    ...rest
  } = props as ResolvedProps;

  const textLabel = typeof label === 'string' && label.trim() !== '' ? label
    : typeof ariaLabel === 'string' && ariaLabel.trim() !== '' ? ariaLabel : undefined;
  const referenced = typeof ariaLabelledBy === 'string' && ariaLabelledBy.trim() !== '' ? ariaLabelledBy : undefined;
  const labelled = textLabel !== undefined || referenced !== undefined;
  const classes = ['pero-ui-glyph', className].filter(Boolean).join(' ');
  const a11y = {
    focusable: labelled && focusable != null ? focusable : 'false',
    role: labelled ? 'img' : undefined,
    'aria-label': referenced ? undefined : textLabel,
    'aria-labelledby': referenced,
    'aria-hidden': labelled ? undefined : true,
  };

  if (glyph) {
    return (
      <svg
        {...rest}
        ref={ref}
        className={classes}
        width={width ?? size ?? 16}
        height={height ?? size ?? 16}
        viewBox={viewBox ?? glyph.viewBox}
        fill={fill ?? 'none'}
        stroke={stroke ?? 'currentColor'}
        strokeWidth={strokeWidth ?? glyph.strokeWidth ?? 1.5}
        strokeLinecap={strokeLinecap ?? 'round'}
        strokeLinejoin={strokeLinejoin ?? 'round'}
        {...a11y}
      >
        {glyph.children}
      </svg>
    );
  }

  const shell = family === 'shell';
  const artwork = ownIcon(shell ? shellIcons : uiIcons, name) ?? ownIcon(shell ? shellIcons : uiIcons, fallbackName);
  if (!artwork) {
    const legacy = iconArtwork(name ?? fallbackName ?? 'app');
    return <svg {...legacy.props} {...rest} ref={ref} className={classes} width={width ?? size ?? 16} height={height ?? size ?? 16} {...a11y}>{legacy.children}</svg>;
  }
  const box = size ?? (shell ? 18 : 16);
  const Lucide = artwork;
  return (
    <Lucide
      {...rest}
      ref={ref}
      className={classes}
      width={width ?? box}
      height={height ?? box}
      fill={fill ?? 'none'}
      stroke={stroke ?? 'currentColor'}
      strokeWidth={strokeWidth ?? 2}
      strokeLinecap={strokeLinecap ?? 'round'}
      strokeLinejoin={strokeLinejoin ?? 'round'}
      {...a11y}
    />
  );
});
