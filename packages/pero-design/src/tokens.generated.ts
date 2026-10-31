/** Generated from spec/pero-design/design.tsp. Do not edit. */
export const designContract = {
  "space": {
    "space4": 4,
    "space8": 8,
    "space12": 12,
    "space16": 16,
    "space20": 20,
    "space24": 24,
    "iconGap": 6
  },
  "typePx": {
    "title": 22,
    "heading": 16,
    "body": 14,
    "caption": 12,
    "label": 11
  },
  "typeWeight": {
    "title": "semibold",
    "heading": "semibold",
    "listTitle": "medium",
    "body": "regular"
  },
  "radii": {
    "panel": 12,
    "selection": 8,
    "button": 6,
    "kbd": 5,
    "badge": 4,
    "cell": 2
  },
  "metrics": {
    "sidebarNavRow": 32,
    "menuRow": 32,
    "subRow": 26,
    "leadBox": 18,
    "subIndent": 12,
    "libraryHeader": 88,
    "actionButtonHeight": 32,
    "actionButtonPadding": 12,
    "ghostIconButton": 28,
    "searchFieldHeight": 32,
    "readerMaxWidth": 720,
    "composerMax": 800,
    "sidebarWidth": 224,
    "listColumn": 336
  },
  "colors": {
    "page": {
      "light": "#F7F9FC",
      "dark": "#0B1420"
    },
    "sidebar": {
      "light": "#EEF3F8",
      "dark": "#192A3B"
    },
    "list": {
      "light": "#F1F5F9",
      "dark": "#3D4C5B"
    },
    "reading": {
      "light": "#FFFFFF",
      "dark": "#121F2E"
    },
    "text": {
      "light": "#172536",
      "dark": "#EAF1F8"
    },
    "textMuted": {
      "light": "#596B7D",
      "dark": "#ACBBCB"
    },
    "action": {
      "light": "#007F86",
      "dark": "#55D5DD"
    },
    "actionHover": {
      "light": "#00666D",
      "dark": "#82E5EA"
    },
    "onAction": {
      "light": "#FFFFFF",
      "dark": "#0B1420"
    },
    "accentSoft": {
      "light": "#E7F3F5",
      "dark": "#12363E"
    },
    "border": {
      "light": "#DCE4ED",
      "dark": "#34485D"
    },
    "danger": {
      "light": "#B54445",
      "dark": "#F1A4A4"
    },
    "focus": {
      "light": "#007F86",
      "dark": "#55D5DD"
    }
  },
  "chatProse": {
    "paragraphGap": "2/5",
    "headingBottom": "7/20",
    "headingFollow": "1/4",
    "ruleSpace": "8/5",
    "quotePad": "9/10",
    "quoteBorder": 2,
    "listIndent": "7/5",
    "tableScale": "14/15",
    "h1Scale": "9/5",
    "h1Line": "5/4",
    "h1Gap": "11/10",
    "h2Scale": "4/3",
    "h2Line": "27/20",
    "h2Gap": "8/5",
    "h3Scale": "17/15",
    "h3Line": "27/20",
    "h3Gap": "7/5",
    "h4Scale": "1/1",
    "h4Line": "27/20",
    "h4Gap": "7/5",
    "h5Scale": "14/15",
    "h5Line": "27/20",
    "h5Gap": "7/5",
    "h6Scale": "13/15",
    "h6Line": "27/20",
    "h6Gap": "7/5"
  }
} as const;
export const { space, typePx, typeWeight, radii, metrics, colors: colorRoles, chatProse } = designContract;
