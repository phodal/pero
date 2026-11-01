"""Admit pinned Hugging Face files to Data's existing downloader.

A Paper handoff is untrusted input, not a grant. This owner re-resolves metadata
and offers a separate explicit download operation. No arbitrary download URL,
filesystem path, code execution or model deserialization is accepted.
"""
from dataclasses import asdict, dataclass
import hashlib
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

from sources import Checksum, Source

HF_HOSTS = ('huggingface.co', 'us.aws.cdn.hf.co', 'cas-bridge.xethub.hf.co',
            'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co')
MAX_METADATA = 2 * 1024 * 1024
MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024


@dataclass(frozen=True)
class HubReference:
    kind: str
    repoId: str
    revision: str

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) - {'kind', 'repoId', 'revision', 'sourceUrl'}:
            raise ValueError('Expected a Hugging Face resource reference')
        kind, repo, revision = value.get('kind'), value.get('repoId'), value.get('revision')
        if kind not in ('model', 'dataset'):
            raise ValueError('Only model and dataset downloads are supported')
        if not isinstance(repo, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,95}/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}', repo):
            raise ValueError('Invalid Hugging Face repository ID')
        if not isinstance(revision, str) or not re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}', revision):
            raise ValueError('An immutable Hugging Face commit is required')
        result = cls(kind, repo, revision)
        if 'sourceUrl' in value and value['sourceUrl'] != result.url():
            raise ValueError('Source URL does not match the resource identity')
        return result

    def url(self):
        return 'https://huggingface.co/' + ('datasets/' if self.kind == 'dataset' else '') + self.repoId

    def metadata_url(self):
        return f'https://huggingface.co/api/{self.kind}s/{self.repoId}/revision/{self.revision}?blobs=true'


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def hub_metadata(reference):
    # Only this fixed provider API is queried; caller URLs/headers are never used.
    request = Request(reference.metadata_url(), headers={'User-Agent': 'Pero-Data/1.0', 'Accept-Encoding': 'identity'})
    try:
        with build_opener(_NoRedirect()).open(request, timeout=15) as response:
            if response.status != 200 or response.headers.get_content_type() != 'application/json':
                raise ValueError('Hugging Face did not return file metadata')
            body = response.read(MAX_METADATA + 1)
    except (HTTPError, URLError, OSError) as error:
        raise ValueError('Cannot resolve this revision. Check provider availability or access restrictions.') from error
    if len(body) > MAX_METADATA:
        raise ValueError('Repository metadata exceeds the 2 MiB limit')
    result = json.loads(body)
    if not isinstance(result, dict):
        raise ValueError('Invalid Hugging Face metadata')
    return result


def files_at_revision(reference, metadata):
    if metadata.get('sha') != reference.revision:
        raise ValueError('Provider metadata does not match the requested revision')
    if metadata.get('gated') or metadata.get('private'):
        raise ValueError('This resource requires provider access approval; authenticated downloads are not supported here')
    card = metadata.get('cardData') or {}
    license_name = card.get('license', '') if isinstance(card, dict) else ''
    if isinstance(license_name, list) and all(isinstance(item, str) for item in license_name):
        license_name = ', '.join(license_name)
    license_name = license_name[:256] if isinstance(license_name, str) and license_name else 'Unknown'
    siblings = metadata.get('siblings')
    if not isinstance(siblings, list):
        raise ValueError('Provider did not return a file list')
    sources, skipped = [], 0
    for item in siblings[:200]:
        if not isinstance(item, dict):
            skipped += 1
            continue
        filename = item.get('rfilename')
        lfs = item.get('lfs') or {}
        if not isinstance(lfs, dict):
            lfs = {}
        size = item.get('size', lfs.get('size'))
        if (not isinstance(filename, str) or not filename or len(filename) > 500
                or any(c in filename for c in ('\\', '\x00', '\n', '\r'))
                or any(part in ('', '.', '..') for part in filename.split('/'))
                or type(size) is not int or not 0 < size <= MAX_FILE_BYTES):
            skipped += 1
            continue
        sha256, blob = lfs.get('sha256'), item.get('blobId')
        if isinstance(sha256, str) and re.fullmatch(r'[a-f0-9]{64}', sha256):
            checksum = Checksum('sha256', sha256, 'Hugging Face LFS SHA256 at pinned commit')
        elif not lfs and isinstance(blob, str) and re.fullmatch(r'[a-f0-9]{40}', blob):
            checksum = Checksum('git-sha1', blob, 'Hugging Face Git blob ID at pinned commit; includes Git object header')
        else:
            skipped += 1
            continue
        source_url = reference.url() + '/blob/' + reference.revision + '/' + quote(filename, safe='/')
        identity = hashlib.sha256(json.dumps([source_url, size, asdict(checksum)], sort_keys=True).encode()).hexdigest()
        sources.append(Source(identity, reference.repoId + ' / ' + filename, reference.kind,
            filename.rsplit('/', 1)[-1], size, license_name, reference.revision, source_url,
            reference.url() + '/resolve/' + reference.revision + '/' + quote(filename, safe='/'), HF_HOSTS, (checksum,)))
    warnings = []
    if skipped:
        warnings.append(f'{skipped} files lack supported size/integrity metadata or exceed the 20 GiB limit.')
    if len(siblings) > 200:
        warnings.append('Only the first 200 files were inspected; the repository list is incomplete.')
    if license_name == 'Unknown':
        warnings.append('License is unknown. Review the provider terms before downloading.')
    return tuple(sources), warnings


class ResearchAssets:
    def __init__(self, downloads, metadata=hub_metadata):
        self.downloads, self.metadata = downloads, metadata
        path = downloads.catalog.directory / 'research-sources.json'
        records = json.loads(path.read_text()) if path.exists() else []
        self.sources = {item['id']: Source(**{**item, 'hosts': tuple(item['hosts']),
                        'checksums': tuple(Checksum(**checksum) for checksum in item['checksums'])}) for item in records}

    def command(self, value):
        if not isinstance(value, dict):
            raise ValueError('Expected a research download request')
        action = value.get('action')
        fields = {'prepare': {'action', 'resources'}, 'download': {'action', 'sourceId', 'confirm'},
                  'status': {'action'}, 'cancel': {'action'}}
        if action not in fields or set(value) != fields[action]:
            raise ValueError('Supply exactly the fields for prepare, download, status or cancel')
        if action == 'prepare':
            values = value['resources']
            if not isinstance(values, list) or not 1 <= len(values) <= 8:
                raise ValueError('Choose 1–8 pinned model or dataset resources')
            references = tuple(HubReference.parse(item) for item in values)
            sources, warnings = {}, []
            for reference in references:
                try:
                    resolved, notes = files_at_revision(reference, self.metadata(reference))
                    sources.update((item.id, item) for item in resolved)
                    warnings.extend(notes)
                except (ValueError, TypeError, KeyError, OSError) as error:
                    warnings.append(reference.repoId + ': ' + str(error)[:300])
            with self.downloads.catalog.lock:
                merged = {**self.sources, **sources}
                if len(merged) > 500:
                    raise ValueError('The prepared-source catalog has reached its 500-file limit')
                self.downloads.catalog.atomic('research-sources.json', [asdict(item) for item in merged.values()])
                self.sources = merged
            return dict(sources=[item.public() for item in sources.values()], warnings=warnings,
                        status='ready' if sources else 'blocked')
        if action == 'download':
            if value['confirm'] is not True or not isinstance(value['sourceId'], str):
                raise ValueError('Review the file, size and license and explicitly confirm this download')
            with self.downloads.catalog.lock:
                source = self.sources.get(value['sourceId'])
                if source is None:
                    raise ValueError('Prepare this source before requesting its download')
                for asset in self.downloads.catalog.listing():
                    if asset['source'] == source.sourceUrl and asset['revision'] == source.revision and asset['localAvailable']:
                        return dict(status='already-local', asset=asset, **self.downloads.state())
                if self.downloads.job and self.downloads.job.sourceId == source.id and self.downloads.job.status == 'running':
                    return self.downloads.state()
                # Admission occurs only here, never when a manifest is inspected.
                self.downloads.sources = tuple({item.id: item for item in (*self.downloads.sources, source)}.values())
                self.downloads.start(source.id)
                return self.downloads.state()
        if action == 'cancel':
            self.downloads.cancel()
        return dict(preparedSources=[item.public() for item in self.sources.values()], **self.downloads.state())
