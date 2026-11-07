"""Loopback provider transports for the real killable research worker."""
from http.client import HTTPConnection
import json
from pathlib import Path
import socket
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def loopback_work(output, directory, value):
    trace = Path(directory) / 'fixture-worker.jsonl'
    with trace.open('a') as stream:
        stream.write(json.dumps(dict(stage='entered', operation=value['operation'])) + '\n')
    import paper_agent.research_jobs as jobs
    from paper_agent.literature import LiteratureClient
    from paper_agent.resource_fetch import PublicMetadata

    config = json.loads(Path(__file__).with_name('fixture.json').read_text())
    endpoint = urlsplit(config['provider'])
    assert endpoint.hostname == '127.0.0.1'

    def fetch(url, *, timeout, headers):
        with trace.open('a') as stream:
            stream.write(json.dumps(dict(stage='literature-fetch', url=url)) + '\n')
        original = urlsplit(url)
        assert original.hostname == 'api.openalex.org' and original.scheme == 'https'
        target = config['provider'] + '/metadata' + original.path
        if original.query:
            target += '?' + original.query
        return urlopen(Request(target, headers=headers), timeout=timeout)

    def resolve(host, port, *args, **kwargs):
        assert host == 'papers.fixture.example' and port == 443
        # The injected connection owns all networking. This address is never dialled.
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.216.34', 443))]

    def connection(host, address, timeout):
        assert host == 'papers.fixture.example' and address == '93.184.216.34'
        return HTTPConnection(endpoint.hostname, endpoint.port, timeout=timeout)

    jobs.LiteratureClient = lambda: LiteratureClient(fetch=fetch)
    jobs.PublicMetadata = lambda: PublicMetadata(resolve=resolve, connection=connection)
    with trace.open('a') as stream:
        stream.write(json.dumps(dict(stage='real-worker-dispatch')) + '\n')
    jobs.research_work(output, directory, value)
