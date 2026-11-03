"""Locate a fixed arXiv paper's approved TeX and export copies, entirely offline."""
import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.library_files import paper_directory
from paper_agent.model import Invalid, digest
from paper_agent.research_resources import OfficialHtml, ResearchResource
from paper_agent.source_archive import MAX_ARCHIVE, SourceArchive
from paper_agent.source_downloads import SourceDownload
from paper_agent.store import ResearchStore
from paper_agent.tex_preview import TexPreviews, TexProject


@dataclass(frozen=True)
class SourceLocation:
    cache: Path
    revision: str
    job: SourceDownload
    archive: SourceArchive | None
    project: TexProject | None

    def to_dict(self):
        main_ids = {item.id for item in self.project.entries} if self.project else set()
        root = self.cache / 'research-v1'
        return dict(cache=str(self.cache), revision=self.revision,
            bundleId=self.job.bundleId, resourceId=self.job.resourceId,
            available=self.project is not None, status=self.job.status,
            archiveDigest=self.job.receipt.archiveDigest if self.job.receipt else None,
            archivePath=str(root / 'source-files' / (self.archive.sha256 + '.bin')) if self.archive else None,
            members=[dict(id=m.id, path=m.path, sha256=m.sha256, kind=m.kind,
                localPath=str(root / 'source-members' / (m.sha256 + '.bin')),
                main=m.id in main_ids, imageAvailable=m.preview,
                previewPath=str(root / 'source-previews' / (m.id + '.png')) if m.preview else None)
                for m in self.archive.members] if self.archive else [])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arxiv', required=True, help='Exact arXiv identifier including vN')
    parser.add_argument('--cache', action='append', type=Path, help='Authorized App data root; repeat for explicit profiles')
    parser.add_argument('--paper-dir', type=Path, help='Export directory override; default matches Library Save')
    args = parser.parse_args(argv)
    try:
        url = 'https://arxiv.org/abs/' + args.arxiv
        target = OfficialHtml.from_resource(ResearchResource.linked(url, url))
        home = Path(os.environ.get('PERO_HOME', str(Path.home() / '.pero'))).expanduser()
        if args.cache:
            roots = args.cache
        elif os.environ.get('PERO_APP_DATA'):
            roots = [Path(os.environ['PERO_APP_DATA'])]
        elif profile := os.environ.get('PERO_NATIVE_DATA_DIR') or os.environ.get('PERO_DESKTOP_DATA_DIR'):
            roots = [Path(profile) / 'app-data/paper-agent']
        else:
            roots = [home / 'app-data/paper-agent', home / 'native-preview/app-data/paper-agent']
        roots = tuple(dict.fromkeys((p.parent if p.name == 'research-v1' else p).expanduser().resolve() for p in roots))
        locations = []
        for root in roots:
            if not (root / 'research-v1').is_dir():
                continue
            store = ResearchStore(root)
            for bundle in store.imports.bundles():
                for resource in bundle.resources:
                    if (resource.kind != 'source_archive' or resource.id not in bundle.sourceDownloadIds
                            or (resource.workIdentity, resource.revision) != ('arxiv:' + target.work, target.revision)):
                        continue
                    _, job = store.source_downloads.job(bundle.id, resource.id)
                    available = store.source_downloads.available(job)
                    project = TexPreviews(store, None).project(bundle.id, resource.id) if available else None
                    archive = SourceArchive.from_record(store._read('source-archives', project.archive_digest)) if project else None
                    locations.append(SourceLocation(root, target.revision, job, archive, project))
        directory = paper_directory(args.paper_dir, create=False).expanduser().resolve()
        archive_digests = {item.archive.sha256 for item in locations if item.archive}
        copies, paths = [], set()
        for stem in (target.work.replace('/', '-') + target.revision, target.work.replace('/', '-')):
            for path in (*directory.glob(stem + '-src.*'), *directory.glob(stem + '.tex')):
                if path in paths or not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_ARCHIVE:
                    continue
                paths.add(path)
                sha = digest(path.read_bytes())
                copies.append(dict(path=str(path), sha256=sha, matchesApprovedArchive=sha in archive_digests))
        print(json.dumps(dict(schema='pero.paper-source-locations.v1',
            workIdentity='arxiv:' + target.work, revision=target.revision,
            searchedCaches=[str(p) for p in roots], exportDirectory=str(directory),
            sources=[item.to_dict() for item in locations], exportCopies=copies,
            limitation='Locations only; no read observation, extraction, download or compilation. Unmatched export copies do not prove the requested version.'), ensure_ascii=False))
        return 0 if any(item.project for item in locations) else 4
    except (Invalid, OSError, ValueError) as error:
        print(json.dumps(dict(error=str(error)), ensure_ascii=False))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
