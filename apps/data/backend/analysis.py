"""Chart documents, source, and exports for one catalog version. Charts are files, not catalog rows."""
from dataclasses import asdict
from hashlib import sha256
import json
from pathlib import Path
import sys

# The shell loads the shared chart core. The core does not import this App.
_shared = Path(__file__).resolve().parents[3] / 'harness/go/charts/python'
sys.path.insert(0, str(_shared if _shared.is_dir() else Path(__file__).parent / '_core'))
from catalog import InspectionUnavailable
from chart_document import ChartDocument, document_for_view
from dataset import Invalid, export_records
from datasets import PreviewRequest, ViewSpec, fields

CHART_LIMIT = 2 * 1024 * 1024


class Analysis:
    def __init__(self, catalog):
        self.catalog = catalog
        self.charts = catalog.directory / 'charts'
        self.exports = catalog.directory / 'exports'

    def _target(self, value, allowed):
        fields(value, (*allowed, 'parserVersion'))
        request = PreviewRequest.parse({key: item for key, item in value.items() if key != 'columns'}, max_offset=None)
        view = request.view
        try:
            asset, inspection = self.catalog._inspect(request)
        except InspectionUnavailable as error:
            raise ValueError(str(error)) from error
        if 'columns' in value and value.get('columns') is not None:
            view = ViewSpec.parse(dict(view.public(), columns=value['columns']))
        inspection = inspection.admit(view, request.offset, request.limit)
        return asset, inspection, inspection.view

    def source(self, value):
        asset, inspection, _admitted = self._target(value, ('datasetId', 'assetId', 'view'))
        return dict(datasetId=value['datasetId'], assetId=asset.id, sha256=asset.sha256, name=asset.name,
                    format='json_lines' if asset.format in ('jsonl', 'ndjson') else asset.format,
                    bytes=asset.size, content=inspection.records.source,
                    view=inspection.spec.public(), viewId=_admitted.identity(inspection.records),
                    report=asdict(inspection.report))

    def read(self, value):
        asset, inspection, admitted = self._target(value, ('datasetId', 'assetId', 'view', 'offset', 'limit', 'columns'))
        try:
            window = admitted.read(inspection.records)
        except Invalid as error:
            raise ValueError(str(error)) from error
        window.update(datasetId=value['datasetId'], assetId=asset.id, sha256=asset.sha256,
                      viewId=admitted.identity(inspection.records), report=asdict(inspection.report))
        return window

    def export(self, value):
        asset, inspection, admitted = self._target(value, ('datasetId', 'assetId', 'view'))
        rows = admitted.selection.apply(admitted.query.apply(inspection.records))
        manifest = dict(schema='pero.dataset-export.v1', dataset=value['datasetId'], assetId=asset.id,
                        sha256=asset.sha256, name=asset.name,
                        sourceFormat='json_lines' if inspection.records.json_lines else asset.format,
                        view=inspection.spec.public() | dict(columns=list(admitted.columns)),
                        parserVersion=inspection.report.parserVersion, report=asdict(inspection.report),
                        viewId=admitted.identity(inspection.records), records=len(rows),
                        provenance=[dict(ordinal=row.ordinal, pointer=row.pointer, line=row.line) for row in rows])
        content = '{"manifest":' + json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + ',"rows":' + export_records(rows) + '}\n'
        digest = sha256(content.encode()).hexdigest()
        self._write(self.exports, digest + '.export.json', content)
        return dict(id=digest, name=Path(asset.name).stem + '.export.json', records=len(rows),
                    bytes=len(content.encode()), content=content)

    def create_chart(self, value):
        fields(value, ('datasetId', 'assetId', 'view', 'chartDocument', 'aggregation', 'parserVersion'))
        asset, inspection, admitted = self._target(
            {key: value[key] for key in ('datasetId', 'assetId', 'view', 'parserVersion') if key in value},
            ('datasetId', 'assetId', 'view'))
        try:
            document = document_for_view(inspection.records, admitted, value.get('chartDocument'), value.get('aggregation'))
        except Invalid as error:
            raise ValueError(str(error)) from error
        document['source'].update(catalogDatasetId=value['datasetId'], assetId=asset.id, sha256=asset.sha256,
                                  dataView=inspection.spec.public(),
                                  parserVersion=inspection.report.parserVersion, report=asdict(inspection.report))
        return self._store_document(document)

    def validate_chart(self, value):
        if set(value) == {'content'} and isinstance(value['content'], str):
            content = value['content']
        elif set(value) == {'document'}:
            content = json.dumps(value['document'], ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
        else:
            raise ValueError('Supply one chart document or its exact JSON content')
        if len(content.encode()) > CHART_LIMIT:
            raise ValueError('The chart document exceeds 2 MiB')
        digest = sha256(content.encode()).hexdigest()
        path = self.charts / (digest + '.chart.json')
        if path.is_file() and path.read_text(encoding='utf-8') == content:
            return dict(document=json.loads(content), artifactId=digest, content=content)
        document = json.loads(content)
        source = document.get('source') if isinstance(document, dict) else None
        if isinstance(source, dict) and 'dataset' in source:
            raise ValueError('Dataset provenance is not a saved local chart; create it from the dataset again')
        try:
            document = ChartDocument.admit(document).json()
        except Invalid as error:
            raise ValueError(str(error)) from error
        return self._store_document(document, content=None)

    def list_charts(self):
        charts = []
        if not self.charts.is_dir():
            return charts
        for path in sorted(self.charts.glob('*.chart.json')):
            content = path.read_text(encoding='utf-8')
            digest = path.name.removesuffix('.chart.json')
            if sha256(content.encode()).hexdigest() != digest:
                continue
            document = json.loads(content)
            charts.append(dict(artifactId=digest, title=document['title'], type=document['chart']['type'],
                               source=document['source']['label']))
        return charts

    def read_chart(self, digest):
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('Invalid chart')
        path = self.charts / (digest + '.chart.json')
        try:
            content = path.read_text(encoding='utf-8')
        except FileNotFoundError:
            raise ValueError('The chart is unavailable') from None
        if sha256(content.encode()).hexdigest() != digest:
            raise ValueError('The saved chart digest does not match')
        return dict(document=json.loads(content), artifactId=digest, content=content)

    def _store_document(self, document, content=None):
        if content is None:
            content = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
        if len(content.encode()) > CHART_LIMIT:
            raise ValueError('The chart document exceeds 2 MiB')
        digest = self._write(self.charts, sha256(content.encode()).hexdigest() + '.chart.json', content)
        return dict(document=json.loads(content) if content[0] == '{' else document, artifactId=digest, content=content)

    def _write(self, directory, filename, content):
        directory.mkdir(exist_ok=True)
        path = directory / filename
        temporary = path.with_suffix(path.suffix + '.tmp')
        temporary.write_text(content, encoding='utf-8')
        temporary.replace(path)
        return path.name.removesuffix('.chart.json').removesuffix('.export.json')
