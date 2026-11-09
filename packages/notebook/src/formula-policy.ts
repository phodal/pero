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
  // Excel Python runs caller-supplied code when the workbook calculates.
  "PY",
  "PYTHON",
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

/** Unicode spaces and format characters are not part of a function name. */
function isIgnorable(character: string): boolean {
  return /[\s\p{Cf}]/u.test(character);
}

/** A formula call or DDE link, not a mention inside text or a worksheet name. */
export function isExternalFormula(source: string): boolean {
  if (!source.startsWith("=")) return false;
  for (let index = 1; index < source.length;) {
    const character = source[index];
    if (character === "\"" || character === "'") {
      const quote = character;
      const contentStart = index + 1;
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
      // '[Workbook]Sheet'!A1 reads another file when a spreadsheet calculates it.
      if (quote === "'" && source[index] === "!" && source.slice(contentStart, index - 1).includes("[")) return true;
      continue;
    }
    if (character === "|") return true;
    if (/[A-Za-z_]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && (/[A-Za-z0-9._]/.test(source[index]) || isIgnorable(source[index]))) index += 1;
      const token = [...source.slice(start, index)].filter(part => !isIgnorable(part)).join("");
      if (source[index] === "(" && isExternalName(bareName(token))) return true;
      continue;
    }
    index += 1;
  }
  return false;
}
