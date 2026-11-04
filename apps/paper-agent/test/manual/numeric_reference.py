"""Opt-in real-paper wiring demonstration with AI-labelled input, not human review.

The hard-coded visual point is an approximate reference input supplied by an AI.
This script does not locate curves or validate the science automatically.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from paper_agent.axis_calibration import AxisCalibration
from paper_agent.local_pdf import LocalPdf
from paper_agent.model import Invalid, digest
from paper_agent.numeric_records import NumericRecords
from paper_agent.pdf import PdfAnnotation
from paper_agent.pdf_files import PdfFiles
from paper_agent.store import ResearchStore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf_directory', type=Path)
    parser.add_argument('output_directory', type=Path)
    args = parser.parse_args()
    root, out = args.pdf_directory, args.output_directory
    if (out / 'store').exists():
        parser.error('Use a fresh output directory; prior assessments change this demonstration')
    out.mkdir(parents=True, exist_ok=True)
    now = '2026-11-04T02:58:00Z'
    store = ResearchStore(out / 'store')
    files = PdfFiles()
    data = (root / '19930083484.pdf').read_bytes()
    expected = 'd03f1dabbc5fecbc8333443794ba9c33fb6632c2af9efd0237d76a96528829b8'
    if digest(data) != expected:
        raise ValueError('Original TN-2825 PDF digest mismatch')
    store.import_pdf(LocalPdf.parse(data, 'NACA-TN-2825-original.pdf'), files, now)
    document = next(store.pdf(i) for i in store._list('pdfs')
                    if store.pdf(i).file_digest == expected)
    annotation = PdfAnnotation.create(dict(
        kind='figure', page=28,
        rects=[dict(x=.27, y=.12, width=.46, height=.63)],
        note='AI-only visual POC; not human verification or scientific acceptance.'), document, now)
    store.save_annotation(annotation, files.crop(data, annotation))
    records = NumericRecords(store)
    extraction = records.extract(dict(annotationId=annotation.id), now)
    base = dict(annotationId=annotation.id, extractionId=extraction['id'])
    identity = dict(
        metric='Upper-surface section normal-force coefficient',
        condition='Mach 0.7 at the printed tick; angle of attack 4 degrees',
        series='NACA 0006 solid curve', statistic='approximate visually selected point',
        unit='dimensionless')
    unresolved = dict(
        identity=identity, sourceKind='figure', method='visual', role='derived_reference',
        rawText='approximately 0.50; unresolved AI visual reading', value=None,
        semanticConfirmed=False, unitConfirmed=False, transcriptionConfirmed=False,
        seriesReliable=False, directionReliable=False)
    first = records.assess(dict(base, evidence=[unresolved]), now)
    assert first['assessment']['status'] == 'unavailable'
    try:
        records.freeze(dict(assessmentId=first['id']), now)
    except Invalid as error:
        assert error.status == 409
    else:
        raise AssertionError('Unresolved value frozen')

    # Explicit AI-supplied y calibration. There is deliberately no x-axis fit.
    axis = dict(
        ticks=[dict(pixel=309, rawText='.6', value=.6),
               dict(pixel=585, rawText='.4', value=.4)],
        scale='linear', scaleConfirmed=True, unitConfirmed=True,
        multiplierConfirmed=True, transcriptionConfirmed=True, multiplier=1, pixel=441)
    value = AxisCalibration.parse(axis).point_value()
    reason = (
        'AI visually traced the solid NACA0006 upper-surface curve at the printed Mach .7 tick; '
        'approximate crop pixel x=766,y=441. Y ticks .6 at309 and .4 at585 in the '
        '1207x2115-pixel crop; top-left origin. No x calibration: transformed Mach spacing. '
        'Curve/grid overlap and stroke thickness make the reading approximate, about 0.50. '
        'Extra digits are calibration arithmetic, not measurement precision. No quantified '
        'uncertainty, independent validation, human review, reproduction run, or scientific '
        'acceptance. Caption supplies conditions but no numeric point cross-check.')
    reviewed = dict(
        identity=identity, sourceKind='figure', method='manual', role='derived_reference',
        rawText='approximately 0.50 from visual curve at Mach .7', value=value,
        semanticConfirmed=True, unitConfirmed=True, transcriptionConfirmed=True,
        seriesReliable=True, directionReliable=True, axis=axis,
        reviewer='AI visual inspection for POC; not human verification',
        reason=reason, previousId=first['evidence'][0]['id'])
    second = records.assess(dict(
        base, previousAssessmentId=first['id'], evidence=[reviewed]), now)
    assert second['assessment']['status'] == 'numeric_ready', second
    frozen = records.freeze(dict(assessmentId=second['id']), now)

    # New store: establish persisted evidence rather than reuse cached projections.
    reopened = ResearchStore(out / 'store')
    again = NumericRecords(reopened)
    assert again.reference(frozen['id']) == frozen
    report = again.report(frozen['id'], frozen=True)
    assert report['acceptance'] == 'unverified'
    assert report['reference']['reference']['scientificAcceptance'] == 'not_assessed'
    assert report['history'][0]['id'] == first['id']
    assert reopened.pdf_bytes(reopened.pdf(document.id)) == data
    assert again.image(extraction['id']) == records.image(extraction['id'])
    cross_check = report['assessment']['assessment']['captionAxisCrossCheck']
    assert cross_check['status'] == 'not_checked'
    (out / 'source.pdf').write_bytes(reopened.pdf_bytes(reopened.pdf(document.id)))
    (out / 'selected-region.png').write_bytes(again.image(extraction['id']))
    (out / 'report.json').write_text(json.dumps(report, indent=2))
    (out / 'report.md').write_text(report['markdown'])
    summary = dict(
        value=value, approximateDisplay='0.50', pointPixels=dict(x=766, y=441),
        cropPixels=dict(width=1207, height=2115), axis=axis,
        initialStatus=first['assessment']['status'], reviewedStatus=second['assessment']['status'],
        reviewer=reviewed['reviewer'], referenceId=frozen['id'], extractionId=extraction['id'],
        reportAcceptance=report['acceptance'],
        scientificAcceptance=frozen['reference']['scientificAcceptance'],
        captionAxisCrossCheck=cross_check, reopenedOriginalSha256=digest(data),
        sourceReopened=True, cropReopened=True, initialFreezeBlocked=True)
    (out / 'summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
