import { parseMystAttributes } from '@pero/notebook/myst';
import { parseNamedReference } from '@pero/notebook/named-reference';
import { isSourceExcerptAttributes } from '@pero/notebook/source-excerpt';
import { isScientificContentAttributes } from '@pero/notebook/scientific-designs';
import { isSampleIntakeAttributes } from '@pero/notebook/sample-intake';
import { parseAppCanvasBinding } from '@pero/notebook/app-canvas';
import { parseMixturePreparation } from '@pero/notebook/mixture';
import { isSavedSearchAttributes } from '@pero/notebook/saved-search';
import { isGridPresentation } from '@pero/notebook/grid-presentation';
import { parseSheetOperations } from '@pero/notebook/sheet-operations';
import type { Spreadsheet } from '@pero/notebook/spreadsheet';
import { isStructuredTableAttributes } from '@pero/notebook/structured-table';
import { spreadsheetLimits } from '@pero/notebook';
import { isAttachmentAttributes } from '@pero/notebook/attachment';
import { isPaperCitationSnapshot } from '@pero/notebook/paper-evidence';
import { isControlEvidenceSnapshot, parseControlEvidenceLocation } from '@pero/notebook/control-evidence';
import { persistedBlockTypes } from '@pero/notebook/interchange';
import { registeredDocumentBlock } from '@pero/notebook/scientific-block';

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
  const registered = registeredDocumentBlock(kind);
  if (registered) {
    try {
      registered.validate({ ...attrs, blockId: typeof attrs.blockId === 'string' && attrs.blockId ? attrs.blockId : 'clipboard' });
      return true;
    } catch { return false; }
  }
  switch (kind) {
    case 'mystDocument':
      try { parseMystAttributes(attrs); return true; } catch { return false; }
    case 'namedReference': try { parseNamedReference(attrs); return true; } catch { return false; }
    case 'sourceExcerpt': return isSourceExcerptAttributes(attrs);
    case 'reactionScheme':
    case 'chemical': return isScientificContentAttributes(kind, attrs);
    case 'sampleIntake': return isSampleIntakeAttributes(attrs);
    case 'appCanvas':
      try { parseAppCanvasBinding(attrs.binding); return text(attrs.label, 200); } catch { return false; }
    case 'mixturePrep':
      try { return text(attrs.label, 200) && !!parseMixturePreparation(attrs.mixture); } catch { return false; }
    case 'savedSearch':
      return isSavedSearchAttributes({ ...attrs, blockId: 'clipboard' });
    case 'inputTable':
    case 'registrationTable':
    case 'lookupTable':
      return isStructuredTableAttributes(kind, attrs);
    case 'attachment':
      return isAttachmentAttributes(attrs);
    case 'spreadsheet': {
      const { sheet, label, annotations } = attrs;
      if (!text(label, 200) || !object(sheet) || Object.keys(sheet).length !== 3) return false;
      const { rows, columns } = sheet;
      if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1 || rows > spreadsheetLimits.rows ||
          typeof columns !== 'number' || !Number.isInteger(columns) || columns < 1 || columns > spreadsheetLimits.columns) return false;
      return isGridPresentation(attrs, sheet as unknown as Spreadsheet) && cells(sheet.cells, rows, columns, value => text(value, spreadsheetLimits.cellLength)) &&
        cells(annotations ?? {}, rows, columns, value => object(value) && Object.keys(value).length === 2 &&
          text(value.unit, 128) && ids(value.evidenceIds)) &&
        parseSheetOperations(attrs, sheet as unknown as Spreadsheet) !== null;
    }
    case 'retainedBlock': {
      const { originalType, payload, blockId } = attrs;
      const structural = new Set(['doc', 'text', 'hardBreak', 'referenceMention', 'listItem', 'taskItem']);
      if (typeof originalType !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,64}$/.test(originalType)) return false;
      if (persistedBlockTypes.includes(originalType as typeof persistedBlockTypes[number]) || structural.has(originalType)) return false;
      if (!object(payload) || payload.type !== originalType) return false;
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 65_536) return false;
      if (object(payload.attrs) && 'blockId' in payload.attrs && blockId !== undefined && payload.attrs.blockId !== blockId) return false;
      return true;
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
