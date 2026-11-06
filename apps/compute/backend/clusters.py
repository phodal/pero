"""Saved cluster configuration drafts; no connection or scheduler execution."""
from dataclasses import asdict, dataclass, replace
import json
from pathlib import Path
import re
import uuid


@dataclass(frozen=True)
class ClusterDraft:
    name: str
    host: str
    account: str = ''
    partition: str = ''
    workdir: str = ''
    id: str = ''

    @classmethod
    def parse(cls, value):
        limits = {'name': 120, 'host': 255, 'account': 120, 'partition': 120, 'workdir': 1024, 'id': 40}
        if not isinstance(value, dict) or set(value) - limits.keys():
            raise ValueError('Only cluster name, host, account, partition and work directory may be saved')
        fields = {}
        for name, maximum in limits.items():
            text = value.get(name, '')
            if not isinstance(text, str) or len(text) > maximum or any(ord(char) < 32 for char in text):
                raise ValueError(f'Invalid {name}')
            fields[name] = text.strip()
        if not fields['name'] or not fields['host']:
            raise ValueError('Cluster name and host are required')
        if fields['id'] and not re.fullmatch(r'cluster-[0-9a-f]{32}', fields['id']):
            raise ValueError('Invalid cluster identity')
        return cls(**fields)


@dataclass(frozen=True)
class Selection:
    clusterId: str

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) != {'clusterId'} or not isinstance(value['clusterId'], str):
            raise ValueError('Choose a saved cluster draft')
        return cls(value['clusterId'])


class ClusterStore:
    def __init__(self, directory):
        self.path = Path(directory) / 'clusters.json'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.clusters = ()
        self.selected = None
        if self.path.exists():
            saved = json.loads(self.path.read_text(encoding='utf-8'))
            if saved.get('schemaVersion') != 1 or not isinstance(saved.get('clusters'), list):
                raise ValueError('Unsupported cluster configuration file')
            self.clusters = tuple(ClusterDraft.parse(item) for item in saved['clusters'])
            ids = [item.id for item in self.clusters]
            self.selected = saved.get('selectedClusterId')
            if not all(ids) or len(set(ids)) != len(ids) or self.selected not in [None, *ids]:
                raise ValueError('Invalid saved cluster selection')

    def state(self):
        return {'clusters': [asdict(item) | {'connectionStatus': 'not_connected'} for item in self.clusters],
                'selectedClusterId': self.selected, 'jobs': None, 'jobsStatus': 'not_connected'}

    def _persist(self, clusters, selected):
        content = {'schemaVersion': 1, 'clusters': [asdict(item) for item in clusters], 'selectedClusterId': selected}
        pending = self.path.with_suffix('.pending')
        pending.write_text(json.dumps(content, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        pending.replace(self.path)
        self.clusters, self.selected = clusters, selected
        return self.state()

    def save(self, draft):
        if draft.id:
            if not any(item.id == draft.id for item in self.clusters):
                raise ValueError('Cluster draft no longer exists')
            clusters = tuple(draft if item.id == draft.id else item for item in self.clusters)
        else:
            draft = replace(draft, id='cluster-' + uuid.uuid4().hex)
            clusters = (*self.clusters, draft)
        return self._persist(clusters, draft.id)

    def select(self, selection):
        if not any(item.id == selection.clusterId for item in self.clusters):
            raise ValueError('Cluster draft no longer exists')
        return self._persist(self.clusters, selection.clusterId)
