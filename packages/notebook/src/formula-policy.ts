/** Formulas whose calculation can reach another program or service. */

const externalNames = new Set([
  "WEBSERVICE",
  "FILTERXML",
  "RTD",
  "IMAGE",
  "STOCKHISTORY",
  "IMPORTDATA",
  "IMPORTXML",
  "IMPORTHTML",
  "IMPORTFEED",
  "IMPORTRANGE",
  "GOOGLEFINANCE",
  "CALL",
  "REGISTER",
  "REGISTER.ID",
]);

export const externalFormulaNames = [...externalNames];

const prefixes = ["_XLFN.", "_XLUDF."];

function bareName(token: string): string {
  let name = token.toUpperCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) {
        name = name.slice(prefix.length);
        changed = true;
      }
    }
  }
  return name;
}

function isExternalName(name: string): boolean {
  if (externalNames.has(name)) return true;
  const separator = name.lastIndexOf(".");
  return separator >= 0 && externalNames.has(name.slice(separator + 1));
}

/** A formula call or DDE link, not a mention inside text or a worksheet name. */
export function isExternalFormula(source: string): boolean {
  if (!source.startsWith("=")) return false;
  for (let index = 1; index < source.length;) {
    const character = source[index];
    if (character === "\"" || character === "'") {
      const quote = character;
      index += 1;
      while (index < source.length) {
        if (source[index] === quote) {
          if (source[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (character === "|") return true;
    if (/[A-Za-z_]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9._]/.test(source[index])) index += 1;
      let cursor = index;
      while (cursor < source.length && /[ \t\r\n]/.test(source[cursor])) cursor += 1;
      if (source[cursor] === "(" && isExternalName(bareName(source.slice(start, index)))) return true;
      continue;
    }
    index += 1;
  }
  return false;
}
