"""Fixed public source metadata. No model deserialization or remote URL input."""
from dataclasses import asdict, dataclass


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
           ('huggingface.co', 'cas-bridge.xethub.hf.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co'),
           (Checksum('sha256', 'd5773bf9440e96d6eb8c598f84bd0e6369fcfa432f626a87f890e07da3c651c9',
                     'Hugging Face file LFS SHA256 at pinned commit'),)),
)
