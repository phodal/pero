"""Persist selected-result observations and deterministic reference reports.

This is a local numerical reading record, not a full-paper ResearchStudy or a
reproduction verdict. The existing study's exact-passage requirements stay intact.
"""
import json

from .model import Invalid, digest, mapping, sequence
from .pdf import PdfAnchor
from .numeric_extraction import NumericExtractor
from .numeric_evidence import NumericEvidence, ReferenceAssessment
from .docling_layout import configured_docling_layout, convert_docling_pdf, docling_layout_status


class NumericRecords:
    def __init__(self, store):
        self.store = store
        self.extractor = NumericExtractor()

    def selection(self, identity):
        annotation = self.store.annotation(identity)
        document = self.store.pdf(annotation.document_id)
        if annotation.kind != 'figure' or len(annotation.rects) != 1:
            raise Invalid('Select a single figure region before preparing reference values')
        anchor = PdfAnchor(document.id, document.file_digest, annotation.page, annotation.rects).check(document)
        return annotation, document, anchor

    def save(self, kind, identity, record):
        with self.store.lock:
            existing = self.store._list(kind)
            if identity in existing:
                return self.store._read(kind, identity)
            # Two deliberate revisions can occur in one second. Preserve their
            # saved order without changing immutable content identities.
            record = dict(record, sequence=len(existing) + 1)
            self.store._write(kind, identity, record)
            return record

    def overview(self, annotation_id):
        annotation, _, _ = self.selection(annotation_id)
        result = dict(annotation=annotation.to_dict())
        for key, kind in (('extractions', 'numeric-extractions'), ('assessments', 'numeric-assessments'),
                          ('references', 'numeric-references'), ('layouts', 'numeric-layouts')):
            rows = [self.store._read(kind, identity) for identity in self.store._list(kind)]
            result[key] = sorted((row for row in rows if row['annotationId'] == annotation_id),
                                 key=lambda row: (row.get('sequence', 0), row['createdAt'], row['id']))
        return result

    def layout_status(self):
        return docling_layout_status(configured_docling_layout(self.store.root))

    def layout(self, value, now):
        value = mapping(value, 'optional page layout')
        annotation, document, anchor = self.selection(value.get('annotationId'))
        config = configured_docling_layout(self.store.root)
        if config is None:
            raise Invalid('Optional Docling layout is not configured; the local PDFium/Tesseract reader remains available', 503)
        result = convert_docling_pdf(self.store.pdf_bytes(document), document, anchor.page, config)
        content = dict(annotationId=annotation.id, selectedAnchor=anchor.to_dict(), result=result)
        identity = digest(content)
        return self.save('numeric-layouts', identity, dict(id=identity, **content, createdAt=now,
                         recordUrl=f'/api/numeric/layouts/{identity}'))

    def extract(self, value, now):
        value = mapping(value, 'numeric extraction')
        annotation, document, anchor = self.selection(value.get('annotationId'))
        observed = self.extractor.extract(self.store.pdf_bytes(document), document, anchor)
        content = dict(annotationId=annotation.id, result=observed.to_dict())
        identity = digest(content)
        record = dict(id=identity, **content, createdAt=now,
                      imageUrl=f'/api/numeric/extractions/{identity}/image')
        with self.store.lock:
            directory = self.store.root / 'numeric-images'
            directory.mkdir(parents=True, exist_ok=True)
            image = directory / (identity + '.png')
            if not image.exists():
                image.write_bytes(observed.image_bytes)
            return self.save('numeric-extractions', identity, record)

    def image(self, identity):
        record = self.store._read('numeric-extractions', identity)
        data = (self.store.root / 'numeric-images' / (identity + '.png')).read_bytes()
        if digest(data) != record['result']['image']['digest']:
            raise Invalid('Saved numeric crop no longer matches its observation', 409)
        return data

    def known_evidence(self, annotation_id):
        known = []
        for identity in self.store._list('numeric-assessments'):
            row = self.store._read('numeric-assessments', identity)
            if row['annotationId'] == annotation_id:
                known.extend(NumericEvidence.parse(item) for item in row['evidence'])
        return tuple(known)

    def propose(self, value, now):
        """Agent proposals never carry review authority, corrections or acceptance."""
        value = mapping(value, 'numeric proposal')
        extraction_id = value.get('extractionId')
        if not extraction_id:
            raise Invalid('Read the selected region before proposing values')
        extraction = self.store._read('numeric-extractions', extraction_id)
        if extraction['annotationId'] != value.get('annotationId'):
            raise Invalid('Extraction belongs to another selected figure', 409)
        proposed = []
        for item in sequence(value.get('evidence'), 32, 'numeric proposals'):
            item = mapping(item, 'numeric proposal')
            if item.get('method') not in ('native_text', 'ocr', 'visual', 'pixel_calibration'):
                raise Invalid('Agent proposals cannot assert manual review')
            # Allowlist content, not caller-supplied review flags or old revisions.
            candidate = {key: item.get(key) for key in
                         ('identity', 'sourceKind', 'method', 'rawText', 'value')}
            candidate.update(role='paper_reported', engine='agent_proposal',
                             engineVersion='unspecified', extractionId=extraction_id)
            if item.get('axis') is not None:
                axis = mapping(item['axis'], 'proposed axis')
                candidate['axis'] = {key: axis[key] for key in
                                     ('ticks', 'scale', 'multiplier', 'pixel') if key in axis}
            proposed.append(candidate)
        if not proposed:
            raise Invalid('No candidate values were proposed; keep the source unresolved')
        return self.assess(dict(annotationId=value.get('annotationId'),
                                extractionId=extraction_id, evidence=proposed), now)

    def assess(self, value, now):
        value = mapping(value, 'numeric assessment')
        annotation, document, anchor = self.selection(value.get('annotationId'))
        extraction_id = value.get('extractionId')
        extraction = None
        if extraction_id:
            extraction = self.store._read('numeric-extractions', extraction_id)
            if extraction['annotationId'] != annotation.id:
                raise Invalid('Extraction belongs to another selected figure', 409)
        previous_id = value.get('previousAssessmentId')
        previous = self.store._read('numeric-assessments', previous_id) if previous_id else None
        if previous and previous['annotationId'] != annotation.id:
            raise Invalid('Previous assessment belongs to another figure', 409)
        proposed = []
        for item in sequence(value.get('evidence'), 32, 'numeric evidence'):
            item = mapping(item, 'numeric evidence')
            source_id = item.get('extractionId') or extraction_id
            source = self.store._read('numeric-extractions', source_id) if source_id else None
            if source and source['annotationId'] != annotation.id:
                raise Invalid('Evidence extraction belongs to another selected figure', 409)
            engine = dict(engine=source['result']['ocr']['engine'],
                          engineVersion=source['result']['ocr']['version'] or 'unavailable') if source and item.get('method') == 'ocr' else {}
            proposed.append(NumericEvidence.parse({**item, **engine,
                'extractionId': source_id, 'anchor': item.get('anchor', anchor.to_dict())}))
        for item in proposed:
            item.anchor.check(document)
            if item.anchor.page != anchor.page or item.anchor.rects != anchor.rects:
                raise Invalid('Evidence must refer to the selected figure region')
            if item.previous_id:
                prior = next((p for p in previous['evidence'] if p['id'] == item.previous_id), None) if previous else None
                if prior is None:
                    raise Invalid('Corrected evidence must name a candidate in the previous assessment')
            if item.source_kind == 'author_data':
                raise Invalid('This PDF-region POC cannot bind author result files; choose the actual PDF source')
            if item.method in ('native_text', 'ocr'):
                if not item.extraction_id:
                    raise Invalid('Read this figure before citing its native text or OCR')
                observed = self.store._read('numeric-extractions', item.extraction_id)['result']
                source = 'native' if item.method == 'native_text' else 'ocr'
                tokens = {candidate['raw'] for candidate in observed['observations'] if candidate['source'] == source}
                if item.raw_text not in tokens:
                    raise Invalid('Raw numeric observation must occur in the saved regional reading')
        # The core retains known same-quantity evidence even when the caller
        # starts an independent request rather than naming a prior assessment.
        assessment = ReferenceAssessment.assess_known(proposed, self.known_evidence(annotation.id))
        if 'invalid_correction_target' in assessment.issues:
            raise Invalid('A correction must keep the original quantity and role; start a new candidate for a different quantity')
        evidence = assessment.evidences
        content = dict(annotationId=annotation.id, extractionId=extraction_id,
                       previousAssessmentId=previous_id, evidence=[item.to_dict() for item in evidence],
                       assessment=assessment.to_dict())
        identity = digest(content)
        record = dict(id=identity, **content, createdAt=now)
        return self.save('numeric-assessments', identity, record)

    def freeze(self, value, now):
        value = mapping(value, 'freeze numeric reference')
        saved = self.store._read('numeric-assessments', value.get('assessmentId'))
        assessment = ReferenceAssessment.assess(tuple(NumericEvidence.parse(item) for item in saved['evidence']))
        reference = assessment.freeze().to_dict()
        content = dict(assessmentId=saved['id'], annotationId=saved['annotationId'], reference=reference)
        identity = digest(content)
        if identity in self.store._list('numeric-references'):
            return self.store._read('numeric-references', identity)
        current = ReferenceAssessment.assess_known(assessment.evidences, self.known_evidence(saved['annotationId']))
        if current.id != assessment.id:
            raise Invalid('New observations or corrections exist for this quantity; assess the current evidence before freezing', 409)
        record = dict(id=identity, **content, createdAt=now)
        return self.save('numeric-references', identity, record)

    def reference(self, identity):
        return self.store._read('numeric-references', identity)

    def report(self, identity, frozen=False):
        reference = self.reference(identity) if frozen else None
        saved = self.store._read('numeric-assessments', reference['assessmentId'] if reference else identity)
        annotation, document, anchor = self.selection(saved['annotationId'])
        paper = self.store.paper(document.paper_id)
        assessment = saved['assessment']
        sections = [dict(heading='Reference preparation', content=(
            f"Status: {assessment['status']}. This is a selected-result reading record, not a reproduction verdict. "
            'The remainder of this paper has not been read by this operation. Review identity is client-reported, '
            'not independent peer review.'))]
        evidence_rows = []
        for item in saved['evidence']:
            evidence_rows.append(f"- {item['sourceKind']} / {item['method']}: {item.get('rawText', '')!r} → "
                                 f"{item.get('value')} {item['identity']['unit']}; "
                                 f"confidence {item['confidence']['level']}; evidence {item['id']}")
            if item.get('extractionId'):
                evidence_rows.append(f"  Extraction record: {item['extractionId']}")
            if item.get('reviewer'):
                evidence_rows.append(f"  Local review: {item['reviewer']}; reason: {item['reason']}")
            if item.get('axis'):
                axis = item['axis']
                evidence_rows.append(f"  Axis: {axis['selectedScale']}; multiplier {axis['multiplier']}; "
                    f"target pixel {axis['pixel']}; ticks " + ', '.join(f"{t['rawText']}@{t['pixel']}" for t in axis['ticks']))
        sections.append(dict(heading='Values and provenance', content='\n'.join(evidence_rows)))
        # No model-authored prose can suppress ambiguity or turn an unchecked pair
        # into a successful cross-check. The domain projection is included verbatim.
        cross_check = assessment.get('captionAxisCrossCheck', {})
        sections.append(dict(heading='图注和坐标轴不一致 / Caption and axis inconsistencies',
                             content=(json.dumps(cross_check, ensure_ascii=False) + '\n' +
                                 '\n'.join(f"- Values {item['values']}: {'resolved by explicit correction' if item['resolved'] else 'unresolved'}; "
                                           f"evidence {', '.join(item['evidenceIds'])}" for item in assessment.get('conflicts', [])))
                             if cross_check else 'Not checked: corresponding caption and axis evidence are missing.'))
        reasons = assessment.get('reasons', assessment.get('issues', []))
        sections.append(dict(heading='Checks and limitations', content='\n'.join(map(str, reasons)) or
                             'No recorded admission blockers. This does not establish scientific correctness. '
                             'This POC does not estimate pixel/line-width measurement uncertainty or run a reproduction comparison.'))
        history, previous_id = [], saved.get('previousAssessmentId')
        while previous_id:
            previous = self.store._read('numeric-assessments', previous_id)
            history.append(dict(id=previous['id'], assessment=previous['assessment'], evidence=previous['evidence']))
            previous_id = previous.get('previousAssessmentId')
        if history:
            sections.append(dict(heading='Prior observations and corrections', content='\n'.join(
                f"- {row['id']}: {row['assessment']['status']} (retained in history)" for row in history)))
        sections.append(dict(heading='Original source', content=(f'{paper.title}, PDF page {anchor.page}; '
            f'original SHA-256 {document.file_digest}; normalized region '
            f'{json.dumps(anchor.rects[0].to_dict())}. Original source and OCR remain separate.')))
        title = f'Numeric reference: {paper.title}'
        markdown = '# ' + title + '\n\n' + '\n\n'.join('## ' + item['heading'] + '\n\n' + item['content'] for item in sections)
        extractions = []
        for extraction_id in sorted({item['extractionId'] for item in saved['evidence'] if item.get('extractionId')}):
            observed = self.store._read('numeric-extractions', extraction_id)
            extractions.append(dict(id=extraction_id, imageUrl=observed['imageUrl'],
                recordUrl=f'/api/numeric/extractions/{extraction_id}', anchor=observed['result']['anchor'],
                classification=observed['result']['classification'], ocrStatus=observed['result']['ocr']['status'],
                ocrEngine=observed['result']['ocr']['engine'], ocrVersion=observed['result']['ocr']['version']))
        return dict(title=title, markdown=markdown, anchor=anchor.to_dict(), sections=sections,
                    assessment=saved, reference=reference, history=history,
                    extractionSources=extractions, acceptance='unverified')
