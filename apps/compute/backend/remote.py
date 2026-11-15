"""Private Host bridge. The App never owns SSH credentials or remote processes."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import os
import re
import socket

from clusters import ClusterDraft


@dataclass(frozen=True)
class RemoteRequest:
    operation: str
    cluster: ClusterDraft | None = None
    samples: int | None = None
    repetitions: int | None = None
    id: str | None = None
    digest: str | None = None

    @classmethod
    def parse(cls, value, clusters):
        if not isinstance(value, dict) or not isinstance(value.get('operation'), str):
            raise ValueError('Choose a remote compute operation')
        operation = value['operation']
        if operation in ('probe', 'prepare'):
            keys = {'operation', 'clusterId'} | ({'samples', 'repetitions'} if operation == 'prepare' else set())
            if set(value) != keys:
                raise ValueError('Choose a saved connection and fixed method inputs')
            cluster = next((item for item in clusters if item.id == value['clusterId']), None)
            if cluster is None:
                raise ValueError('Saved connection no longer exists')
            if operation == 'probe':
                return cls(operation, cluster=cluster)
            samples, repetitions = value['samples'], value['repetitions']
            if type(samples) is not int or not 1000 <= samples <= 10000000:
                raise ValueError('Samples must be an integer from 1000 to 10000000')
            if type(repetitions) is not int or not 1 <= repetitions <= 100000:
                raise ValueError('Repetitions must be an integer from 1 to 100000')
            return cls(operation, cluster=cluster, samples=samples, repetitions=repetitions)
        if operation not in ('submit', 'observe', 'cancel', 'collect', 'artifact'):
            raise ValueError('Unknown remote compute operation')
        keys = {'operation', 'id'} | ({'digest'} if operation in ('submit', 'artifact') else set())
        if set(value) != keys or not isinstance(value['id'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,120}', value['id']):
            raise ValueError('Choose the original prepared attempt')
        digest = value.get('digest')
        if operation in ('submit', 'artifact') and (not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest)):
            raise ValueError('A frozen SHA-256 digest is required')
        return cls(operation, id=value['id'], digest=digest)

    def wire(self):
        value = {key: item for key, item in asdict(self).items() if item is not None}
        if self.operation == 'prepare':
            value['input'] = {'samples': value.pop('samples'), 'repetitions': value.pop('repetitions')}
        return value


class RemoteComputeError(RuntimeError):
    pass


class RemoteCompute:
    def __init__(self, address=None, token=None):
        self.address = address if address is not None else os.environ.get('PERO_REMOTE_COMPUTE_ADDRESS', '')
        self.token = token if token is not None else os.environ.get('PERO_REMOTE_COMPUTE_TOKEN', '')

    @property
    def available(self):
        return bool(self.address and self.token)

    def request(self, request):
        if not self.available:
            if request.operation == 'state':
                return {'available': False, 'attempts': [], 'error': 'Open Compute in a Host with remote execution enabled'}
            raise RemoteComputeError('Host remote compute capability is unavailable')
        try:
            host, port = self.address.rsplit(':', 1)
            if host != '127.0.0.1' or not 0 < int(port) < 65536:
                raise ValueError('Invalid private Host endpoint')
            with socket.create_connection((host, int(port)), timeout=45) as stream:
                stream.sendall(json.dumps({'token': self.token, 'request': request.wire()}).encode('utf-8') + b'\n')
                with stream.makefile('rb') as response:
                    line = response.readline(4 * 1024 * 1024 + 1)
            if len(line) > 4 * 1024 * 1024 or not line.endswith(b'\n'):
                raise ValueError('Invalid private Host response frame')
            result = json.loads(line)
            if not isinstance(result, dict):
                raise ValueError('Invalid private Host response')
            if isinstance(result.get('error'), str):
                raise RemoteComputeError(result['error'])
            if not isinstance(result.get('value'), dict):
                raise ValueError('Missing private Host result')
            return result['value']
        except (OSError, ValueError) as error:
            raise RemoteComputeError(f'Host remote compute response unavailable: {error}. Inspect the original attempt before retrying a submission') from error
