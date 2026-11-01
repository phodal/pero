"""Registered sources and strict admission of explicitly selected pinned HF files."""
from dataclasses import asdict, dataclass
import re
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Checksum:
    algorithm: str
    value: str
    provenance: str


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    kind: str
    filename: str
    size: int
    license: str
    revision: str
    sourceUrl: str
    url: str
    hosts: tuple[str, ...]
    checksums: tuple[Checksum, ...]
    bundleId: str = ''

    def public(self):
        return {k: v for k, v in asdict(self).items() if k not in ('url', 'hosts')}


SOURCES = (
    Source('norman-2019', 'Norman 2019 · scPerturb', 'dataset',
           'NormanWeissman2019_filtered.h5ad', 698680199, 'CC-BY-4.0',
           'scPerturb-v1.0-zenodo-7041849', 'https://zenodo.org/records/7041849',
           'https://zenodo.org/records/7041849/files/NormanWeissman2019_filtered.h5ad?download=1',
           ('zenodo.org',), (
               Checksum('md5', 'c870e6967d91c017d9da827bab183cd6', 'Zenodo file metadata'),
               Checksum('sha256', 'efde6f5301fe256725dce1d980f37bd96a13481a9a16135515897368e631affc',
                        'Locally observed 2026-10-30 after matching publisher size and MD5; not publisher SHA256'),)),
    Source('mace-mp-0b2-small', 'MACE MP-0b2 small', 'model',
           'mace-mp-0b2-small.model', 67622684, 'MIT',
           'e291ace2bfae073c3ebc7ae2f9479a525989baa7',
           'https://huggingface.co/mace-foundations/mace-mp-0',
           'https://huggingface.co/mace-foundations/mace-mp-0/resolve/e291ace2bfae073c3ebc7ae2f9479a525989baa7/mace-mp-0b2-small.model',
           ('huggingface.co', 'us.aws.cdn.hf.co', 'cas-bridge.xethub.hf.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co'),
           (Checksum('sha256', 'd5773bf9440e96d6eb8c598f84bd0e6369fcfa432f626a87f890e07da3c651c9',
                     'Hugging Face file LFS SHA256 at pinned commit'),)),
)


# Research import accepts only this existing pinned-file host set, never caller hosts.
HF_DOWNLOAD_HOSTS = SOURCES[1].hosts


@dataclass(frozen=True)
class ResearchSelection:
    bundleId: str
    assetId: str | None = None

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) - {'bundleId', 'assetId'}:
            raise ValueError('Choose a saved research bundle and asset')
        bundle, asset = value.get('bundleId'), value.get('assetId')
        if not isinstance(bundle, str) or not re.fullmatch(r'[a-f0-9]{64}', bundle):
            raise ValueError('Invalid research bundle identity')
        if asset is not None and (not isinstance(asset, str) or not re.fullmatch(r'[a-f0-9]{64}', asset)):
            raise ValueError('Invalid research asset identity')
        return cls(bundle, asset)

    def contains(self, source):
        return source.bundleId == self.bundleId and (self.assetId is None or source.id == self.assetId)


@dataclass(frozen=True)
class ResearchAsset:
    source: Source

    @classmethod
    def parse(cls, value):
        fields = {'id', 'name', 'kind', 'filename', 'size', 'license', 'revision',
                  'sourceUrl', 'url', 'sha256', 'bundleId', 'confirmed'}
        if not isinstance(value, dict) or set(value) != fields or value.get('confirmed') is not True:
            raise ValueError('An explicitly confirmed pinned research asset is required')
        ResearchSelection.parse({'bundleId': value['bundleId'], 'assetId': value['id']})
        for field, maximum in (('name', 300), ('filename', 200), ('license', 200),
                               ('revision', 40), ('sourceUrl', 500), ('url', 2000), ('sha256', 64)):
            text = value[field]
            if not isinstance(text, str) or not text or text != text.strip() or len(text) > maximum or any(ord(c) < 32 for c in text):
                raise ValueError(f'Invalid research {field}')
        if value['kind'] not in ('model', 'dataset'):
            raise ValueError('Only model and dataset files may be downloaded')
        if type(value['size']) is not int or value['size'] <= 0:
            raise ValueError('A positive exact file size is required')
        if value['license'].casefold() in ('unknown', 'none', 'null', 'n/a', 'unspecified', 'other'):
            raise ValueError('An explicit known license is required')
        if not re.fullmatch(r'[a-f0-9]{40}', value['revision']) or not re.fullmatch(r'[a-f0-9]{64}', value['sha256']):
            raise ValueError('Pinned commit and LFS SHA256 are required')
        # Strict ASCII paths avoid URL parser aliases, encoded traversal and filesystem paths.
        url, repository = urlsplit(value['url']), urlsplit(value['sourceUrl'])
        for parsed in (url, repository):
            if parsed.scheme != 'https' or parsed.netloc != 'huggingface.co' or parsed.query or parsed.fragment:
                raise ValueError('Only canonical public Hugging Face URLs are accepted')
        parts = url.path.split('/')[1:]
        if value['kind'] == 'dataset':
            if not parts or parts.pop(0) != 'datasets':
                raise ValueError('Dataset URL must name a Hugging Face dataset')
        if len(parts) < 5 or parts[2:4] != ['resolve', value['revision']]:
            raise ValueError('Choose a file at the pinned Hugging Face commit')
        if any(not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', part) or part in ('.', '..') for part in parts):
            raise ValueError('Unsafe repository or file path')
        prefix = '/datasets' if value['kind'] == 'dataset' else ''
        if repository.path != prefix + '/' + '/'.join(parts[:2]) or parts[-1] != value['filename']:
            raise ValueError('Source repository and filename must match the pinned file')
        checksum = Checksum('sha256', value['sha256'], 'Hugging Face file LFS SHA256 at pinned commit')
        return cls(Source(value['id'], value['name'], value['kind'], value['filename'], value['size'],
                          value['license'], value['revision'], value['sourceUrl'], value['url'],
                          HF_DOWNLOAD_HOSTS, (checksum,), value['bundleId']))
