"""One explicit local partition. It cannot submit Slurm or other remote work."""
site_configuration = {
    'systems': [{
        'name': 'pero-local',
        'descr': 'Pero local CPU reference; no Slurm allocation or MPI',
        'hostnames': ['.*'],
        'partitions': [{
            'name': 'cpu', 'scheduler': 'local', 'launcher': 'local',
            'environs': ['builtin'], 'max_jobs': 1,
        }],
    }],
}
