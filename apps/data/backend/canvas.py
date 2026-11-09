"""Declared dataset inspector. Data's catalog owns the mutation and its atomic receipt."""
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import re
from datasets import Dataset, DatasetEdit, identity


def dataset_input(value):
    if not isinstance(value, dict) or set(value) != {'datasetId'}:
        raise ValueError('Choose one dataset identity')
    return identity(value['datasetId'], 'dataset', 'ds-')


def projection(catalog, value):
    dataset_id = dataset_input(value)
    with catalog.lock:
        dataset = catalog.dataset(dataset_id)
        assets = {asset.id: asset for asset in catalog.assets}
        return {'title': dataset.name, 'fields': [
            {'label': 'Dataset', 'value': dataset.id}, {'label': 'Kind', 'value': dataset.kind},
            {'label': 'Project', 'value': dataset.projectRef},
            {'label': 'Archived', 'value': 'Yes' if dataset.archived else 'No'},
        ], 'columns': ['Version', 'SHA-256', 'Availability'],
            'rows': [[version, assets[version].sha256, catalog.availability(assets[version])] for version in dataset.versions[-100:]],
            'notice': 'Showing the last 100 versions.' if len(dataset.versions) > 100 else '',
            'actions': [{'name': 'canvas-archive', 'label': 'Restore dataset' if dataset.archived else 'Archive dataset',
                         'params': {'archived': not dataset.archived}},
                        {'name': 'canvas-update', 'label': 'Save dataset details',
                         'params': {'name': dataset.name, 'projectRef': dataset.projectRef,
                                    'expectedName': dataset.name, 'expectedProjectRef': dataset.projectRef,
                                    'expectedArchived': dataset.archived},
                         'inputs': [{'name': 'name', 'label': 'Dataset name', 'maxLength': 200},
                                    {'name': 'projectRef', 'label': 'Project reference (Data label)', 'maxLength': 200}]}]}


@dataclass(frozen=True)
class DatasetChangeResult:
    dataset: Dataset
    applied: bool
    reason: str = ''


@dataclass(frozen=True)
class DatasetArchiveChange:
    archived: bool

    def apply(self, dataset):
        return DatasetChangeResult(dataset.edit(DatasetEdit(dataset.id, dataset.name, dataset.projectRef, self.archived)), True)


@dataclass(frozen=True)
class DatasetDetailsChange:
    edit: DatasetEdit
    observed: DatasetEdit

    def apply(self, dataset):
        if (dataset.name, dataset.projectRef, dataset.archived) != (self.observed.name, self.observed.projectRef, self.observed.archived):
            return DatasetChangeResult(dataset, False, 'Dataset metadata changed. Refresh the App view before editing.')
        return DatasetChangeResult(dataset.edit(self.edit), True)


@dataclass(frozen=True)
class CanvasOperation:
    operation_id: str
    dataset_id: str
    change: DatasetArchiveChange | DatasetDetailsChange
    digest: str

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) != {'operationId', 'inputs', 'params'}:
            raise ValueError('A scoped Canvas operation is required')
        operation = value['operationId']
        if not isinstance(operation, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', operation):
            raise ValueError('Invalid operation identity')
        dataset_id = dataset_input(value['inputs'])
        params = value['params']
        if not isinstance(params, dict):
            raise ValueError('Choose dataset metadata')
        if set(params) == {'archived'}:
            if type(params['archived']) is not bool:
                raise ValueError('Choose the dataset archive state')
            change = DatasetArchiveChange(params['archived'])
        elif set(params) == {'name', 'projectRef', 'expectedName', 'expectedProjectRef', 'expectedArchived'}:
            observed = DatasetEdit.parse({'datasetId': dataset_id, 'name': params['expectedName'],
                                          'projectRef': params['expectedProjectRef'], 'archived': params['expectedArchived']})
            edit = DatasetEdit.parse({'datasetId': dataset_id, 'name': params['name'],
                                      'projectRef': params['projectRef'], 'archived': params['expectedArchived']})
            change = DatasetDetailsChange(edit, observed)
        else:
            raise ValueError('Choose only the declared dataset fields')
        # Host and this declaration use compact, sorted-key UTF-8 JSON.
        digest = sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        return cls(operation, dataset_id, change, digest)

    def retained(self, catalog):
        receipt = catalog.canvas_receipts.get(self.operation_id)
        if receipt and receipt['inputDigest'] != self.digest:
            raise ValueError('Operation identity belongs to different inputs')
        return receipt


def archive(catalog, value):
    operation = CanvasOperation.parse(value)
    if not isinstance(operation.change, DatasetArchiveChange):
        raise ValueError('Choose the dataset archive state')
    return _apply(catalog, operation)


def update(catalog, value):
    operation = CanvasOperation.parse(value)
    if not isinstance(operation.change, DatasetDetailsChange):
        raise ValueError('Choose the dataset details')
    return _apply(catalog, operation)


def _apply(catalog, operation):
    with catalog.lock:
        previous = operation.retained(catalog)
        if previous:
            return previous
        dataset = catalog.dataset(operation.dataset_id)
        result = operation.change.apply(dataset)
        updated = result.dataset
        receipt = {'operationId': operation.operation_id, 'inputDigest': operation.digest, 'status': 'completed',
                   'outcome': 'applied' if result.applied else 'not-applied', 'reason': result.reason,
                   'completedAt': datetime.now(timezone.utc).isoformat(),
                   'dataset': {**{key: item for key, item in asdict(updated).items() if key != 'versions'},
                               'versionCount': len(updated.versions), 'lastVersion': updated.versions[-1] if updated.versions else None}}
        receipts = {**catalog.canvas_receipts, operation.operation_id: receipt}
        # One atomic catalog replacement publishes both metadata and the real receipt.
        catalog._save(catalog.assets, [updated if item.id == operation.dataset_id else item for item in catalog.datasets], catalog.views, receipts)
        return receipt


def status(catalog, value):
    operation = CanvasOperation.parse(value)
    with catalog.lock:
        receipt = operation.retained(catalog)
        return {'state': 'completed', 'result': receipt} if receipt else {'state': 'not-started'}
