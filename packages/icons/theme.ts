import {contentIcons} from './content';
import type {IconThemePackage} from '../../protocol/generated/host';
/** A Host-admitted SVG snapshot; consumers never insert it as HTML. */
export type {IconThemePackage} from '../../protocol/generated/host';
let active:IconThemePackage|null=null;
export function setActiveIconTheme(theme:IconThemePackage|null){active=theme;contentIcons.useTheme(theme);}
export function getActiveIconTheme():IconThemePackage|null{return active;}
