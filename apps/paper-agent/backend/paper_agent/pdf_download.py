"""A selected PDF acquisition is distinct from paper identity and study reading."""
from dataclasses import asdict, dataclass, replace

from .model import ID, Invalid, digest


@dataclass(frozen=True)
class PdfDownloadCommand:
    operation: str
    bundle_id: str
    resource_id: str

    @classmethod
    def parse(cls, value):
        if set(value) != {'operation', 'bundleId', 'resourceId'} or value.get('operation') not in ('start', 'status', 'cancel'):
            raise Invalid('Choose start, status or cancel for one approved PDF')
        if any(not isinstance(value.get(key), str) or not ID.fullmatch(value[key]) for key in ('bundleId', 'resourceId')):
            raise Invalid('Invalid PDF resource reference')
        return cls(value['operation'], value['bundleId'], value['resourceId'])


@dataclass(frozen=True)
class PdfReceipt:
    sourcePageUrl: str
    requestUrl: str
    finalUrl: str
    fetchedAt: str
    fileDigest: str
    size: int
    pageCount: int
    documentId: str
    paperId: str
    explicitVersion: str
    textPages: int = 0
    textCharacters: int = 0
    extractionWarnings: tuple[str, ...] = ()
    workIdentity: str | None = None
    identityStatus: str = 'unresolved'


@dataclass(frozen=True)
class PdfDownload:
    id: str
    bundleId: str
    resourceId: str
    status: str = 'not_started'
    stage: str = 'discovered'
    error: str = ''
    receipt: PdfReceipt | None = None
    restoredAt: str | None = None
    restoreFinalUrl: str | None = None

    @classmethod
    def create(cls, bundle_id, resource_id):
        return cls(digest(dict(bundleId=bundle_id, resourceId=resource_id)), bundle_id, resource_id)

    def start(self):
        if self.status in ('running', 'completed'):
            return self
        return replace(self, status='running', stage='downloading', error='')

    def finish(self, status, error='', receipt=None):
        if self.status != 'running':
            return self
        if status not in ('completed', 'failed', 'cancelled', 'interrupted') or (status == 'completed' and receipt is None):
            raise Invalid('Invalid PDF download transition')
        return replace(self, status=status, stage='readable' if receipt else self.stage, error=error, receipt=receipt or self.receipt)

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_record(cls, value):
        receipt = value.get('receipt')
        if receipt:
            receipt = PdfReceipt(**{**receipt, 'extractionWarnings': tuple(receipt.get('extractionWarnings', ()))})
        return cls(**{**value, 'receipt': receipt})
