"""Explicit, synthetic-only upstream deployment for #152 acceptance probes.

Builds the pinned official source in a caller-selected dedicated Docker context.
No Pero runtime wiring, model credentials, production data or public listeners.
"""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import secrets
import socket
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Extracted pinned NVIDIA source')
    parser.add_argument('--output', type=Path, required=True, help='New private deployment directory')
    parser.add_argument('--context', required=True, help='Already running, task-dedicated Docker context')
    parser.add_argument('--partial-vault', action='store_true')
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    sources = json.loads(Path(__file__).with_name('sources.json').read_text())['upstream']
    for entry in sources['files']:
        if sha256((source / entry['path']).read_bytes()).hexdigest() != entry['sha256']:
            parser.error('Pinned upstream source mismatch: ' + entry['path'])
    output = args.output.absolute()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    docker = ['docker', '--context', args.context]
    for name, directory, extra in (
        ('upstream', source, []),
        ('frontend', source / 'frontend', ['--build-arg', 'PYTHON_API_URL=http://backend:3001']),
        ('mcp', source / 'mcp', []),
    ):
        with (output / f'{name}-build.log').open('w') as log:
            subprocess.run(docker + ['build', '--progress=plain', '-t', f'pero-152-{name}:fc43a826',
                *extra, str(directory)], stdout=log, stderr=subprocess.STDOUT, check=True)
    subprocess.run(docker + ['pull', 'pgvector/pgvector:pg17'], check=True, capture_output=True)
    ports = []
    for _ in range(2):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            ports.append(listener.getsockname()[1])
    env = dict(POSTGRES_HOST='postgres', POSTGRES_PORT='5432', POSTGRES_USER='pero152',
        POSTGRES_PASSWORD=secrets.token_hex(16), POSTGRES_DATABASE='pero152', CONNECTION_STRINGS='',
        INGESTION_SERVICE_URL='http://ingestion:3002', DEFAULT_MODELS_API_KEY='synthetic-disabled',
        DEFAULT_MODELS_ENDPOINT='http://127.0.0.1:1/v1', DEFAULT_MODELS_MODEL='disabled',
        EMBED_API_KEY='synthetic-disabled', EMBED_ENDPOINT='http://127.0.0.1:1/v1', EMBED_MODEL='disabled',
        KUMO_RFM_API_URL='', APP_URL=f'http://127.0.0.1:{ports[0]}', AUTH_SECRET=secrets.token_hex(32),
        AUTO_ONTOLOGY_ADMIN_EMAIL='admin@pero152.invalid', AUTO_ONTOLOGY_ADMIN_PASSWORD=secrets.token_urlsafe(24),
        AUTO_ONTOLOGY_MCP_PUBLIC_URL=f'http://127.0.0.1:{ports[1]}', PYTHON_API_URL='http://backend:3001')
    services = {
        'postgres': dict(image='pgvector/pgvector:pg17', environment={
            'POSTGRES_USER': env['POSTGRES_USER'], 'POSTGRES_PASSWORD': env['POSTGRES_PASSWORD'], 'POSTGRES_DB': 'pero152'},
            volumes=['pgdata:/var/lib/postgresql/data'], healthcheck=dict(
                test=['CMD-SHELL', 'pg_isready -U pero152 -d pero152'], interval='2s', timeout='3s', retries=30)),
        'migrate': dict(image='pero-152-upstream:fc43a826', environment=env, command=['migrate'],
            depends_on={'postgres': {'condition': 'service_healthy'}}),
        'backend': dict(image='pero-152-upstream:fc43a826', environment=dict(env),
            depends_on={'migrate': {'condition': 'service_completed_successfully'}}),
        'ingestion': dict(image='pero-152-upstream:fc43a826', environment=env, command=['ingestion_service'],
            depends_on={'migrate': {'condition': 'service_completed_successfully'}}, healthcheck=dict(
                test=['CMD-SHELL', "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:3002/health/live',timeout=3)\""],
                interval='3s', timeout='5s', retries=15)),
        'frontend-migrate': dict(image='pero-152-frontend:fc43a826', environment=env, working_dir='/app/migrate',
            command=['sh', 'prisma/migrate.sh'], depends_on={'postgres': {'condition': 'service_healthy'}}),
        'frontend': dict(image='pero-152-frontend:fc43a826', environment=env, ports=[f'127.0.0.1:{ports[0]}:3000'],
            depends_on={'backend': {'condition': 'service_healthy'}, 'frontend-migrate': {'condition': 'service_completed_successfully'}}),
        'mcp': dict(image='pero-152-mcp:fc43a826', ports=[f'127.0.0.1:{ports[1]}:3003'],
            environment={'AUTO_ONTOLOGY_API_URL': 'http://frontend:3000', 'AUTO_ONTOLOGY_MCP_PUBLIC_URL': env['AUTO_ONTOLOGY_MCP_PUBLIC_URL']}),
    }
    if args.partial_vault:
        services['backend']['environment']['VAULT_ADDR'] = 'http://vault-unconfigured.invalid:8200'
    for name, service in services.items():
        service['networks'] = ['private', 'edge'] if name in ('frontend', 'mcp') else ['private']
    compose = dict(name='pero152-' + sha256(str(output).encode()).hexdigest()[:8], services=services,
                   volumes={'pgdata': {}}, networks={'private': {'internal': True}, 'edge': {}})
    for name, value in (('runtime-private.json', env), ('compose.json', compose)):
        path = output / name
        path.write_text(json.dumps(value, indent=2) + '\n')
        path.chmod(0o600)
    command = docker + ['compose', '-f', str(output / 'compose.json')]
    with (output / 'startup.log').open('w') as log:
        subprocess.run(command + ['up', '-d', '--wait', '--wait-timeout', '120'],
                       check=True, stdout=log, stderr=subprocess.STDOUT)
    setup = ("CREATE ROLE source152_reader LOGIN PASSWORD 'synthetic-source-only'; "
        "CREATE SCHEMA source152; CREATE TABLE source152.sample(id INTEGER PRIMARY KEY, value NUMERIC); "
        "INSERT INTO source152.sample VALUES (1,2),(2,4); REVOKE ALL ON SCHEMA public FROM PUBLIC; "
        "GRANT USAGE ON SCHEMA source152 TO source152_reader; GRANT SELECT ON source152.sample TO source152_reader;")
    subprocess.run(command + ['exec', '-T', 'postgres', 'psql', '-U', 'pero152', '-d', 'pero152',
        '-v', 'ON_ERROR_STOP=1', '-c', setup], check=True, capture_output=True)
    print(json.dumps(dict(output=str(output), upstreamCommit=sources['commit'],
                         frontend=env['APP_URL'], mcp=env['AUTO_ONTOLOGY_MCP_PUBLIC_URL'])))


if __name__ == '__main__':
    main()
