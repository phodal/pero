"""Pinned optional runtime identities; no platform probing or installation here."""
from dataclasses import dataclass

from .model import Invalid


@dataclass(frozen=True)
class DoclingProfile:
    id: str
    label: str
    ocr_engine: str
    torch_version: str
    torchvision_version: str

    @classmethod
    def select(cls, system, machine, python_version, implementation, macos_version='', abi_flags=''):
        if tuple(python_version[:2]) != (3, 12) or implementation != 'CPython' or abi_flags:
            raise Invalid('Optional Docling requires the release CPython 3.12 ABI', 503)
        if system == 'linux' and machine == 'x86_64':
            return cls('linux-x86_64-cp312', 'Linux x86_64 CPU', 'tesseract-cli',
                       '2.10.0+cpu', '0.25.0+cpu')
        if system == 'darwin':
            if machine != 'arm64':
                raise Invalid('This pinned Docling profile requires native Apple Silicon Python; '
                              'Intel and Rosetta Python are unsupported', 503)
            try:
                major = int(macos_version.split('.')[0])
            except (ValueError, AttributeError):
                raise Invalid('Cannot establish the macOS version for optional Docling', 503)
            if major < 14:
                raise Invalid('The pinned docling-parse wheel requires macOS 14 or newer', 503)
            return cls('macos-arm64-cp312', 'macOS 14+ Apple Silicon CPU / Apple Vision',
                       'apple-vision', '2.10.0', '0.25.0')
        raise Invalid('No pinned optional Docling profile for this operating system and architecture', 503)
