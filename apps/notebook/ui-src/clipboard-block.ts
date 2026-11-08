import { spreadsheetLimits } from '@pero/notebook';
import { isPaperCitationSnapshot } from '@pero/notebook/paper-evidence';
import { isControlEvidenceSnapshot, parseControlEvidenceLocation } from '@pero/notebook/control-evidence';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length <= maximum;

function ids(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 100 &&
    value.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)) &&
    new Set(value).size === value.length;
}

function cells(value: unknown, rows: number, columns: number, valid: (item: unknown) => boolean): boolean {
  return object(value) && Object.keys(value).length <= rows * columns &&
    Object.entries(value).every(([address, item]) => {
      const match = /^([A-Z]{1,2})([1-9][0-9]{0,2})$/.exec(address);
      if (!match || Number(match[2]) > rows) return false;
      const column = [...match[1]].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
      return column <= columns && valid(item);
    });
}

/** Clipboard HTML may contain user-supplied data attributes outside this editor. */
export function isClipboardWidget(kind: string, attrs: Record<string, unknown>): boolean {
  switch (kind) {
    case 'spreadsheet': {
      const { sheet, label, annotations } = attrs;
      if (!text(label, 200) || !object(sheet) || Object.keys(sheet).length !== 3) return false;
      const { rows, columns } = sheet;
      if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1 || rows > spreadsheetLimits.rows ||
          typeof columns !== 'number' || !Number.isInteger(columns) || columns < 1 || columns > spreadsheetLimits.columns) return false;
      return cells(sheet.cells, rows, columns, value => text(value, spreadsheetLimits.cellLength)) &&
        cells(annotations ?? {}, rows, columns, value => object(value) && Object.keys(value).length === 2 &&
          text(value.unit, 128) && ids(value.evidenceIds));
    }
    case 'experiment':
    case 'evidence': {
      const { label, source, snapshot } = attrs;
      if (!text(label, 200)) return false;
      if (source === null) return snapshot === null;
      if (!object(source) || Object.keys(source).length !== 5 ||
          !['app', 'kind', 'id'].every(key => text(source[key], 1024) && !!source[key].trim()) ||
          !text(source.version, 1024) || !text(source.locator, 1024)) return false;
      if (snapshot === null) return true;
      if (kind === 'evidence') {
        return isPaperCitationSnapshot(snapshot) && source.app === 'paper-agent' && source.kind === 'report-citation' &&
          source.id === snapshot.reportId && source.version === snapshot.reportId &&
          source.locator === `pero-app-location://paper-agent/main/report/${snapshot.reportId}/citation/${snapshot.citationIndex}`;
      }
      const location = parseControlEvidenceLocation(source.locator);
      return isControlEvidenceSnapshot(snapshot) && source.app === 'control-lab' && source.kind === 'verification-report' &&
        source.version === snapshot.reportId && location?.trialId === snapshot.trialId && location.experimentId === source.id;
    }
    case 'finding':
      return text(attrs.claim, 32_768) && text(attrs.limitations, 32_768) && ids(attrs.evidenceIds);
    default:
      return false;
  }
}
