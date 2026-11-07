import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from clusters import ClusterDraft, ClusterStore, Selection


class ClustersTest(unittest.TestCase):
    def test_drafts_edit_and_selection_survive_restart_without_claiming_connectivity(self):
        with TemporaryDirectory() as directory:
            store = ClusterStore(directory)
            self.assertEqual(store.state(), {'clusters': [], 'selectedClusterId': None, 'jobs': None, 'jobsStatus': 'not_connected',
                                             'executions': [], 'executionsStatus': 'none'})
            first = store.save(ClusterDraft.parse({'name': '大学集群', 'host': 'login.example', 'account': 'research',
                                                 'partition': 'cpu', 'workdir': '/scratch/research'}))
            identity = first['selectedClusterId']
            second = store.save(ClusterDraft.parse({'name': 'Second site', 'host': 'second.example'}))
            store.select(Selection.parse({'clusterId': identity}))
            store.save(ClusterDraft.parse({'id': identity, 'name': 'Updated site', 'host': 'login.example', 'partition': 'gpu'}))
            restored = ClusterStore(directory).state()
            self.assertEqual(len(restored['clusters']), 2)
            self.assertEqual(restored['clusters'][0]['name'], 'Updated site')
            self.assertEqual(restored['clusters'][0]['partition'], 'gpu')
            self.assertEqual(restored['selectedClusterId'], identity)
            self.assertTrue(all(item['connectionStatus'] == 'not_connected' for item in restored['clusters']))
            self.assertIsNone(restored['jobs'])
            self.assertEqual(restored['jobsStatus'], 'not_connected')
            self.assertEqual(restored['executions'], [])
            self.assertEqual(restored['executionsStatus'], 'none')
            self.assertNotEqual(second['selectedClusterId'], identity)

    def test_configuration_accepts_only_bounded_non_secret_fields(self):
        valid = {'name': 'Cluster', 'host': 'login.example'}
        for invalid in [None, [], {}, {**valid, 'password': 'no'}, {**valid, 'privateKey': 'no'},
                        {**valid, 'host': 'x' * 256}, {**valid, 'name': ''}, {**valid, 'account': 10},
                        {**valid, 'workdir': '/scratch\ncommand'}, {**valid, 'id': '../other'}]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                ClusterDraft.parse(invalid)
        self.assertEqual(ClusterDraft.parse({**valid, 'name': ' Cluster '}).name, 'Cluster')

    def test_unknown_updates_and_failed_persistence_keep_existing_configuration(self):
        with TemporaryDirectory() as directory:
            store = ClusterStore(directory)
            saved = store.save(ClusterDraft.parse({'name': 'Cluster', 'host': 'login.example'}))
            for action in [lambda: store.select(Selection('missing')),
                           lambda: store.save(ClusterDraft('Changed', 'host', id='cluster-' + '0' * 32))]:
                with self.assertRaises(ValueError):
                    action()
            store.path.with_suffix('.pending').mkdir()
            with self.assertRaises(OSError):
                store.save(ClusterDraft('Unsaved', 'another.example'))
            self.assertEqual(store.state(), saved)
            self.assertEqual(ClusterStore(directory).state(), saved)


if __name__ == '__main__':
    unittest.main()
