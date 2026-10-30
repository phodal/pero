// Shared design contract for the web library and the GPUI theme.
// Source of truth for generated tokens. Do not copy these numbers by hand.
// Compile: npm run gen:design
import "@typespec/json-schema";

using JsonSchema;

@jsonSchema
@doc("One contract, two renderers. Color roles use the Pero DESIGN.md light and dark tables. Selection fill is accentSoft. Hairline is border.")
namespace Pero.Design;

model Space {
  space4: 4;
  space8: 8;
  space12: 12;
  space16: 16;
  space20: 20;
  space24: 24;
  iconGap: 6;
}

model TypePx {
  title: 22;
  heading: 16;
  body: 14;
  caption: 12;
  label: 11;
}

model TypeWeight {
  title: "semibold";
  heading: "semibold";
  listTitle: "medium";
  body: "regular";
}

model Radii {
  panel: 12;
  selection: 8;
  button: 6;
  kbd: 5;
  badge: 4;
  cell: 2;
}

model Metrics {
  sidebarNavRow: 32;
  /** Account and choice menus use the same row box as sidebar navigation. */
  menuRow: 32;
  subRow: 26;
  leadBox: 18;
  subIndent: 12;
  libraryHeader: 88;
  actionButtonHeight: 32;
  actionButtonPadding: 12;
  ghostIconButton: 28;
  searchFieldHeight: 32;
  readerMaxWidth: 720;
  sidebarWidth: 224;
  listColumn: 336;
}

/** Page is canvas (`bg`). */
model PageColor { light: "#F7F9FC"; dark: "#0B1420"; }
/** Sidebar is `surface-muted`. */
model SidebarColor { light: "#EEF3F8"; dark: "#192A3B"; }
/** List is the sidebar surface mixed 18% toward white, pinned so both renderers share one hex. */
model ListColor { light: "#F1F5F9"; dark: "#3D4C5B"; }
/** Reading is `surface` (white in light, surface in dark). */
model ReadingColor { light: "#FFFFFF"; dark: "#121F2E"; }
model TextColor { light: "#172536"; dark: "#EAF1F8"; }
model TextMutedColor { light: "#596B7D"; dark: "#ACBBCB"; }
model ActionColor { light: "#007F86"; dark: "#55D5DD"; }
model ActionHoverColor { light: "#00666D"; dark: "#82E5EA"; }
model OnActionColor { light: "#FFFFFF"; dark: "#0B1420"; }
model AccentSoftColor { light: "#E7F3F5"; dark: "#12363E"; }
model BorderColor { light: "#DCE4ED"; dark: "#34485D"; }
/** Danger is the theme `error` role. */
model DangerColor { light: "#B54445"; dark: "#F1A4A4"; }
model FocusColor { light: "#007F86"; dark: "#55D5DD"; }

// Selection fill is AccentSoftColor. Hairline is BorderColor.
alias SelectionFill = AccentSoftColor;
alias Hairline = BorderColor;

@doc("Nav row. `actions` is not used; count is the trailing slot.")
model SidebarRow {
  label: string;
  caption?: string;
  count?: string;
  active: boolean;
  level: "nav" | "sub";
}

@doc("`actions` is a slot role, not a framework element type.")
model LibraryHeader {
  title: string;
  subtitle?: string;
  actions: "actions";
}

model ListRow {
  title: string;
  caption?: string;
  count?: string;
  active: boolean;
  actions: "actions";
}

model ReaderFrame {
  title: string;
  subtitle?: string;
}

model Badge { label: string; }
model OutlineBadge { label: string; }

model EmptyState {
  heading: string;
  caption?: string;
}

model SettingsGroup { label?: string; }

@doc("`actions` is the trailing control slot.")
model SettingsRow {
  label: string;
  caption?: string;
  actions: "actions";
}

model ActionButton {
  label: string;
  kind: "primary" | "ghost";
}

model SearchField { placeholder?: string; }
