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
    "title": 24,
    "heading": 18,
    "body": 14,
    "tab": 13,
    "caption": 12,
    "label": 12
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
    "windowTitlebar": 42,
    "sidebarPadding": 10,
    "sidebarGroupGap": 16,
    "contentTab": 30,
    "contentTabIcon": 14,
    "contentTabClose": 24,
    "sidebarNavRow": 32,
    "sessionRow": 28,
    "sessionStatus": 14,
    "menuRow": 32,
    "subRow": 26,
    "leadBox": 18,
    "subIndent": 12,
    "libraryHeader": 64,
    "actionButtonHeight": 24,
    "actionButtonPadding": 12,
    "ghostIconButton": 28,
    "searchFieldHeight": 24,
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
    "bodyLine": "11/7",
    "paragraphGap": "5/7",
    "headingBottom": "1/5",
    "headingFollow": "11/10",
    "ruleSpace": "8/7",
    "quotePad": "9/10",
    "quoteBorder": 2,
    "listIndent": "2/1",
    "tableScale": "1/1",
    "inlineCode": "9/10",
    "codeSize": "6/7",
    "h1Scale": "9/7",
    "h1Line": "71/50",
    "h1Gap": "1/1",
    "h2Scale": "8/7",
    "h2Line": "71/50",
    "h2Gap": "1/1",
    "h3Scale": "1/1",
    "h3Line": "71/50",
    "h3Gap": "1/1",
    "h4Scale": "1/1",
    "h4Line": "71/50",
    "h4Gap": "1/1",
    "h5Scale": "1/1",
    "h5Line": "71/50",
    "h5Gap": "1/1",
    "h6Scale": "1/1",
    "h6Line": "71/50",
    "h6Gap": "1/1"
  }
} as const;
export const { space, typePx, typeWeight, radii, metrics, colors: colorRoles, chatProse } = designContract;
