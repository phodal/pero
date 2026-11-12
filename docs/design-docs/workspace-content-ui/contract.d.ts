/**
 * PROPOSED API — design artifact, NOT runtime implementation.
 *
 * Do not import this file from an App or export it from @pero/app-sdk/ui.
 * Foundation work must implement and test these contracts in the existing
 * pero-design/app-sdk libraries before any App imports the new components.
 *
 * Reuse existing AppFrame, AppBar, PageHeader, LibraryHeader, Toolbar,
 * Split/SplitPane, Tabs, Button, Feedback, EmptyState and LoadingSkeleton.
 * No fetching, permissions, domain state transitions, routing or chat ownership.
 */
import type { ReactElement, ReactNode } from 'react';

export type ContentInset = 'none' | 'compact' | 'regular';
export type ContentSurface = 'workspace' | 'list' | 'reading';

/**
 * pane: body owns the main vertical scrollbar.
 * content: a nested editor/viewer/virtualized table owns scrolling; body clips
 * its box, but the implementation must not trap otherwise unreachable content.
 */
export type ContentScroll = 'pane' | 'content';

/** One pane's geometry, not a replacement for AppFrame or SplitPane. */
export interface ContentPaneProps {
  /** Stable DOM/test identity. Unique within the document. */
  id: string;
  /** Accessible region name, supplied through the existing i18n layer. */
  label: string;
  /** Use div inside an already labelled SplitPane section/aside. */
  as?: 'section' | 'aside' | 'div';
  surface?: ContentSurface;
  inset?: ContentInset;
  scroll?: ContentScroll;
  /** Visible heading supplied only when it adds a distinct scope. */
  header?: ReactNode;
  /** Existing Toolbar, Search/Select or Tabs controls. No new keyboard model. */
  toolbar?: ReactNode;
  /** Local Feedback supplied by the domain owner. Not a global status enum. */
  feedback?: ReactNode;
  /** Optional compact footer; no placeholder or permanent marketing/help card. */
  footer?: ReactNode;
  /** Maps to aria-busy; never erases retained content by itself. */
  busy?: boolean;
  children: ReactNode;
}

/**
 * Layout order: header -> toolbar -> feedback -> scrollable body -> footer.
 * All fixed slots are optional; absent slots occupy no space.
 * min-width:0/min-height:0; use parent height, not 100vh in an App iframe.
 * Insets and semantic surfaces resolve through shared tokens, in both themes.
 * No root style/className escape hatch; domain content owns its own styling.
 */
export declare function ContentPane(props: ContentPaneProps): ReactElement;

export interface InspectorHeaderProps {
  /** Complete object name. Wrap rather than losing the identifying suffix. */
  title: string;
  /** Optional type/source identity, not an App introduction paragraph. */
  identity?: ReactNode;
  /** Secondary metadata; do not repeat the title or status. */
  subtitle?: ReactNode;
  /** Domain-provided Badge/Feedback, with a text label. */
  status?: ReactNode;
  /** Existing controls: one emphasized object action; others secondary/menu. */
  actions?: ReactNode;
  /** Omit when this pane cannot be dismissed. Owner restores trigger focus. */
  dismiss?: {
    label: string;
    onDismiss(): void;
  };
}

/**
 * Renders an object-level heading, not a new page h1.
 * Keeps status and actions distinct. Does not own panel width or persistence.
 */
export declare function InspectorHeader(props: InspectorHeaderProps): ReactElement;

export interface ContentSectionProps {
  /** Unique region identity; heading is associated with the section. */
  id: string;
  title: string;
  /** Optional real section action, not a duplicate page primary action. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Flat heading + content + shared spacing; no card-in-card shell.
 * If low-frequency content must be collapsed, compose the existing Disclosure.
 * Blocking errors and decision-critical prerequisites stay directly visible.
 */
export declare function ContentSection(props: ContentSectionProps): ReactElement;

export interface MetadataItem {
  /** Stable key, independent of translated label. */
  id: string;
  label: string;
  /** Caller renders zero, missing, stale and unknown deliberately. */
  value: ReactNode;
  /** Code is for paths, hashes and identifiers, not all metadata. */
  format?: 'text' | 'code';
  /** Existing labelled copy/open control; do not wrap the whole row in button. */
  action?: ReactNode;
}

export interface MetadataListProps {
  items: readonly MetadataItem[];
  /** auto aligns labels/values, stacking within narrow containers. */
  layout?: 'auto' | 'stacked';
}

/**
 * Semantic dl/dt/dd. Values can wrap; a copied identifier must remain complete.
 * No metadata fetching, scientific validation, date/unit formatting or inference.
 */
export declare function MetadataList(props: MetadataListProps): ReactElement;
