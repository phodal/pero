"""Compare a frozen research revision with current Data and official arXiv metadata."""
from dataclasses import asdict, dataclass
import time

from .arxiv_versions import ArxivVersion, metadata_url
from .model import Invalid
from .pcgym_domain import PAPER
from .research_record_commands import read_record, record_command
from .research_records import DataVersion
from .research_resources import ArxivPaper


@dataclass(frozen=True)
class VersionObservation:
    subject: str
    name: str
    pinned: str | None
    latest: str | None
    status: str
    source: str | None = None
    sha256: str | None = None

    @classmethod
    def dataset(cls, pinned, current):
        versions = current['versions'] if current and not current['archived'] else ()
        latest = versions[-1] if versions else None
        original = next((version for version in versions if version['versionId'] == pinned.versionId), None)
        if not original or original['sha256'] != pinned.sha256 or original['availability'] != 'present':
            status = 'unknown'
        elif latest['availability'] != 'present':
            status = 'unknown'
        else:
            status = 'changed' if latest['versionId'] != pinned.versionId else 'unchanged'
        return cls(pinned.datasetId, pinned.name, pinned.versionId, latest['versionId'] if latest else None,
                   status, 'Data Workspace', latest['sha256'] if latest else None)


def save_with_data(store, value, now):
    versions = tuple(DataVersion(**version) for version in value['dataVersions'])
    return record_command(store, value['record'], now, data_versions=versions)


def check(store, record_id, datasets, fetch, now):
    record = read_record(store, record_id)
    dataset_by_id = {dataset['datasetId']: dataset for dataset in datasets}
    data = [VersionObservation.dataset(version, dataset_by_id.get(version.datasetId)) for version in record.dataVersions]
    papers = []
    checked = {}
    deadline = time.monotonic() + 10
    for source in record.sourceVersions:
        try:
            paper = store.paper(source.paperId)
            try:
                work = ArxivPaper.from_snapshot(paper)
            except Invalid:
                if not any(attempt.paperId == paper.id for attempt in record.attempts):
                    raise
                # The fixed PC-Gym owner required this exact paper and bound original PDF.
                work, revision = PAPER.removeprefix('arxiv:').rsplit('v', 1)
                work = ArxivPaper(work, 'v' + revision)
        except Invalid:
            papers.append(VersionObservation(source.paperId, 'Saved paper', None, None, 'unsupported'))
            continue
        if work.work not in checked:
            checked[work.work] = None
            remaining = deadline - time.monotonic()
            if remaining > 0:
                try:
                    checked[work.work] = ArxivVersion.parse(work.work, fetch(metadata_url(work.work), timeout=min(4, remaining)))
                except (Invalid, OSError):
                    pass
        observation = checked[work.work]
        latest = observation.revision if observation else None
        status = 'unknown'
        if latest and work.revision:
            if latest == work.revision:
                status = 'unchanged'
            elif int(latest[1:]) > int(work.revision[1:]):
                status = 'changed'
        papers.append(VersionObservation(source.paperId, paper.title, work.identifier,
                                         work.work + latest if latest else None, status, observation.metadata_url if observation else None))
    local = record_command(store, {'operation': 'impact', 'recordId': record_id}, now)
    changed_papers = {row.subject for row in papers if row.status == 'changed'}
    changed_papers.update(row['paperId'] for row in local['items'] if row['status'] == 'changed')
    data_changed = any(row.status == 'changed' for row in data)
    return dict(recordId=record_id, question=record.question, checkedAt=now,
                papers=[asdict(row) for row in papers], datasets=[asdict(row) for row in data],
                methodStatus=local['methodStatus'],
                affectedAttempts=[asdict(attempt) for attempt in record.attempts if attempt.paperId in changed_papers or
                                  local['methodStatus'] == 'changed'],
                affectedReportIds=list(dict.fromkeys(link.reportId for link in record.evidence if link.reportId and
                                         (data_changed or link.paperId in changed_papers))))
