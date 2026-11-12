"""Opt-in live auth probes against the dedicated #152 upstream deployment.

Requires its private runtime JSON and Compose file; never accepts production
credentials. No model invocation, real data or upstream source modification.
"""
import argparse
from hashlib import sha256
import http.cookiejar
import json
from pathlib import Path
import subprocess
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deployment', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--context', default='colima-pero-152')
    parser.add_argument('--partial-vault', action='store_true',
                        help='Probe fail-closed with synthetic credentials; fails if plaintext is persisted')
    args = parser.parse_args()
    runtime = json.loads((args.deployment / 'runtime-private.json').read_text())
    origin = runtime['APP_URL']
    if not origin.startswith('http://127.0.0.1:') or not runtime['AUTO_ONTOLOGY_ADMIN_EMAIL'].endswith('@pero152.invalid'):
        parser.error('This probe only accepts the synthetic loopback #152 deployment')
    args.output.mkdir(parents=True, exist_ok=False)
    docker = ['docker', '--context', args.context, 'compose', '-f', str(args.deployment / 'compose.json')]
    client = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    checks = []

    def request(name, path, expected, body=None, bearer=None, session=False, method=None, extra=None):
        headers = {'Content-Type': 'application/json', 'Origin': origin, **(extra or {})}
        if bearer:
            headers['Authorization'] = 'Bearer ' + bearer
        query = Request(origin + path, data=json.dumps(body).encode() if body is not None else None,
                        headers=headers, method=method)
        try:
            with (client if session else build_opener()).open(query, timeout=20) as response:
                status, raw = response.status, response.read()
        except HTTPError as error:
            status, raw = error.code, error.read()
        checks.append(dict(name=name, expected=expected, status=status, passed=status == expected))
        (args.output / 'checks.json').write_text(json.dumps(checks, indent=2) + '\n')
        print(name, status, flush=True)
        if status != expected:
            raise RuntimeError(f'{name}: HTTP {status}, expected {expected}')
        return json.loads(raw) if raw else {}

    def sql(statement):
        return subprocess.check_output(docker + ['exec', '-T', 'postgres', 'psql', '-U', 'pero152',
            '-d', 'pero152', '-v', 'ON_ERROR_STOP=1', '-Atc', statement], text=True).strip()

    request('no_session', '/api/connections', 401)
    request('forged_identity', '/api/connections', 401, extra={'x-auto-ontology-user-id': 'forged-admin'})
    login = request('real_login', '/api/auth/sign-in/email', 200, session=True,
        body={'email': runtime['AUTO_ONTOLOGY_ADMIN_EMAIL'], 'password': runtime['AUTO_ONTOLOGY_ADMIN_PASSWORD']})
    request('session_read', '/api/connections', 200, session=True)
    created = request('mint_token', '/api/api-tokens', 201, session=True,
                      body={'name': args.output.name, 'expires_in_days': 1})
    token, token_id = created['token'], created['id'].replace("'", "''")
    request('token_read', '/api/connections', 200, bearer=token)
    user_id = login['user']['id'].replace("'", "''")
    try:
        sql(f"UPDATE frontend.\"user\" SET role='viewer' WHERE id='{user_id}'")
        request('downgraded_token_write', '/api/connections', 403, bearer=token,
                body={'connection': {'database': 'must-not-exist'}})
        request('downgraded_token_read', '/api/connections', 200, bearer=token)
    finally:
        sql(f"UPDATE frontend.\"user\" SET role='admin' WHERE id='{user_id}'")
    sql(f"UPDATE frontend.apikey SET \"expiresAt\"=TIMESTAMP '2000-01-01' WHERE id='{token_id}'")
    request('expired_token', '/api/connections', 401, bearer=token)
    request('expired_token_not_manageable', '/api/api-tokens/' + created['id'], 404, session=True, method='DELETE')
    revoked = request('mint_revocation_token', '/api/api-tokens', 201, session=True,
                      body={'name': args.output.name + '-revoke', 'expires_in_days': 1})
    request('before_revoke', '/api/connections', 200, bearer=revoked['token'])
    request('revoke_token', '/api/api-tokens/' + revoked['id'], 200, session=True, method='DELETE')
    request('revoked_token', '/api/connections', 401, bearer=revoked['token'])
    readonly = []
    statements = {
        'read_before': 'SELECT COUNT(*),SUM(value) FROM source152.sample',
        'dml': 'DELETE FROM source152.sample',
        'ddl': 'CREATE TABLE source152.forbidden(id int)',
        'catalog': 'SELECT * FROM public.catalog_database',
        'server_file': "SELECT pg_read_file('/etc/passwd')",
        'multiple_statements': 'SELECT COUNT(*) FROM source152.sample; DELETE FROM source152.sample',
        'read_after': 'SELECT COUNT(*),SUM(value) FROM source152.sample',
    }
    for name, statement in statements.items():
        result = subprocess.run(docker + ['exec', '-T', '-e', 'PGPASSWORD=synthetic-source-only',
            'postgres', 'psql', '-h', 'postgres', '-U', 'source152_reader', '-d', 'pero152',
            '-v', 'ON_ERROR_STOP=1', '-Atc', statement], capture_output=True, text=True, timeout=15)
        expected_read = name in ('read_before', 'read_after')
        passed = (result.returncode == 0 and result.stdout.strip() == '2|6') if expected_read else result.returncode != 0
        readonly.append(dict(name=name, exit_code=result.returncode, stdout=result.stdout.strip(),
                             stderr=result.stderr.strip(), passed=passed))
    (args.output / 'readonly-postgres.json').write_text(json.dumps(readonly, indent=2) + '\n')
    if args.partial_vault:
        database = 'vault-' + sha256(str(args.output).encode()).hexdigest()[:12]
        connection = dict(type='postgresql', host='postgres', port='5432', user='source152_reader',
                          password='synthetic-source-only', database=database, schemas=['source152'])
        query = Request(origin + '/api/connections', data=json.dumps(dict(connection=connection)).encode(),
                        headers={'Content-Type': 'application/json', 'Origin': origin})
        try:
            with client.open(query, timeout=20) as response:
                status = response.status
        except HTTPError as error:
            status = error.code
        stored = sql("SELECT connection->>'password'='synthetic-source-only' FROM public.catalog_database "
                     f"WHERE name='{database}'")
        checks.append(dict(name='partial_vault_fail_closed', status=status,
                           expected='4xx without credential persistence', plaintextPersisted=stored == 't',
                           passed=status >= 400 and stored != 't'))
        (args.output / 'checks.json').write_text(json.dumps(checks, indent=2) + '\n')
    # Only status outcomes are saved. Cookie, password and token values stay in memory.
    passed = all(row['passed'] for row in checks + readonly)
    print(json.dumps(dict(checks=len(checks), readonlyChecks=len(readonly), passed=passed)))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
