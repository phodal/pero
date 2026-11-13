/** pero-design: spacing, type, radii, materials, and the shared chrome components.
 *  Color values stay on the --pero-* theme tokens from DESIGN.md. */
import './tokens.css';
import './components.css';
import './shell.css';

export { Badge, ChatMarkdown, Composer, Kbd, LibraryHeader, ListRow, OutlineBadge, ReaderFrame, SearchField, SettingsGroup, SettingsRow, SidebarRow } from './components';
export { ContentPane, ContentSection, InspectorHeader, MetadataList, contentLayout } from './content';
export type { ContentInset, ContentPaneProps, ContentScroll, ContentSectionProps, ContentSurface, InspectorHeaderProps, MetadataItem, MetadataListProps } from './content';
export { chatProse, colorRoles, designContract, metrics, radii, space, typePx, typeWeight } from './tokens.generated';
export { Sidebar, SidebarGroup, WindowTitlebar } from './shell';
