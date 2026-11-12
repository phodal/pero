"""Opt-in PKCE/MCP probe for the synthetic #152 loopback deployment only."""
import argparse
import base64
import hashlib
import http.cookiejar
from http.client import RemoteDisconnected
import json
from pathlib import Path
import secrets
import socket
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPCookieProcessor, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deployment', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--context', default='colima-pero-152')
    args = parser.parse_args()
    runtime = json.loads((args.deployment / 'runtime-private.json').read_text())
    origin, mcp = runtime['APP_URL'], runtime['AUTO_ONTOLOGY_MCP_PUBLIC_URL']
    if not all(url.startswith('http://127.0.0.1:') for url in (origin, mcp)):
        parser.error('Only the synthetic loopback deployment is supported')
    args.output.mkdir(parents=True, exist_ok=False)
    client = build_opener(NoRedirect(), HTTPCookieProcessor(http.cookiejar.CookieJar()))
    docker = ['docker', '--context', args.context, 'compose', '-f', str(args.deployment / 'compose.json')]
    checks = []

    def sql(statement):
        return subprocess.check_output(docker + ['exec', '-T', 'postgres', 'psql', '-U', 'pero152',
            '-d', 'pero152', '-v', 'ON_ERROR_STOP=1', '-Atc', statement], text=True).strip()

    def request(name, url, expected, body=None, form=False, token=None, extra=None):
        headers = {'Content-Type': 'application/x-www-form-urlencoded' if form else 'application/json', 'Origin': origin}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if url.startswith(mcp + '/mcp'):
            headers['Accept'] = 'application/json, text/event-stream'
        headers.update(extra or {})
        content = urlencode(body).encode() if form else json.dumps(body).encode() if body is not None else None
        query = Request(url, data=content, headers=headers)
        try:
            with (build_opener(NoRedirect()) if token else client).open(query, timeout=20) as response:
                status, raw, meta = response.status, response.read(), response.headers
        except HTTPError as error:
            status, raw, meta = error.code, error.read(), error.headers
        checks.append(dict(name=name, status=status, expected=expected, passed=status == expected))
        (args.output / 'checks.json').write_text(json.dumps(checks, indent=2) + '\n')
        print(name, status, flush=True)
        try:
            data = json.loads(raw)
        except ValueError:
            events = [json.loads(line[6:]) for line in raw.decode().splitlines() if line.startswith('data: ')]
            data = events[-1] if events else {}
        if status != expected:
            detail = str(data.get('error_description', data.get('error', '')))
            for value in (token, *(str(value) for value in (body or {}).values())):
                if value:
                    detail = detail.replace(value, '[redacted]')
            raise RuntimeError(f'{name}: HTTP {status}, expected {expected}: {detail}')
        return data, meta

    initialize = dict(jsonrpc='2.0', id=1, method='initialize', params=dict(
        protocolVersion='2025-03-26', capabilities={}, clientInfo=dict(name='pero152-probe', version='1')))
    request('mcp_missing_token', mcp + '/mcp', 401, initialize)
    request('mcp_invalid_token', mcp + '/mcp', 401, initialize, token='synthetic-invalid')
    login, _ = request('login', origin + '/api/auth/sign-in/email', 200, dict(
        email=runtime['AUTO_ONTOLOGY_ADMIN_EMAIL'], password=runtime['AUTO_ONTOLOGY_ADMIN_PASSWORD']))
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        callback = f'http://127.0.0.1:{listener.getsockname()[1]}/callback'
    registration, _ = request('dynamic_registration', origin + '/api/auth/oauth2/register', 201,
        dict(client_name='pero152-pkce', redirect_uris=[callback], grant_types=['authorization_code', 'refresh_token'],
             response_types=['code'], token_endpoint_auth_method='none', application_type='native'))
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    parameters = dict(response_type='code', client_id=registration['client_id'], redirect_uri=callback,
        scope='openid profile email offline_access', state='pero152', code_challenge=challenge,
        code_challenge_method='S256', resource=mcp + '/mcp')
    _, headers = request('authorize', origin + '/api/auth/oauth2/authorize?' + urlencode(parameters), 302)
    location = urlsplit(headers['Location'])
    consent, _ = request('consent', origin + '/api/auth/oauth2/consent', 200,
                         dict(accept=True, oauth_query=location.query))
    code = parse_qs(urlsplit(consent['url']).query)['code'][0]
    exchange = dict(grant_type='authorization_code', client_id=registration['client_id'],
                    redirect_uri=callback, code_verifier=verifier, code=code, resource=mcp + '/mcp')
    token, _ = request('code_exchange', origin + '/api/auth/oauth2/token', 200, exchange, form=True)
    access = token['access_token']
    request('userinfo', origin + '/api/auth/oauth2/userinfo', 200, token=access)
    initialized, initialized_meta = request('mcp_authenticated_initialize', mcp + '/mcp', 200, initialize, token=access)
    if 'result' not in initialized or 'serverInfo' not in initialized['result']:
        raise RuntimeError('MCP HTTP success did not return an initialized JSON-RPC result')
    session = {'Mcp-Session-Id': initialized_meta['Mcp-Session-Id'],
               'MCP-Protocol-Version': initialized['result']['protocolVersion']}
    request('mcp_initialized_notification', mcp + '/mcp', 202,
            dict(jsonrpc='2.0', method='notifications/initialized'), token=access, extra=session)
    tools, _ = request('mcp_tool_discovery', mcp + '/mcp', 200,
                       dict(jsonrpc='2.0', id=2, method='tools/list', params={}), token=access, extra=session)
    if not tools.get('result', {}).get('tools'):
        raise RuntimeError('MCP discovery returned no actual tools')
    (args.output / 'tool-names.json').write_text(json.dumps(
        [tool['name'] for tool in tools['result']['tools']], indent=2) + '\n')
    readiness, _ = request('mcp_actual_readiness_tool', mcp + '/mcp', 200,
        dict(jsonrpc='2.0', id=3, method='tools/call', params=dict(name='check_readiness', arguments={})),
        token=access, extra=session)
    if readiness.get('error') or readiness.get('result', {}).get('isError'):
        raise RuntimeError('Authenticated readiness tool failed')
    (args.output / 'readiness.json').write_text(json.dumps(readiness, indent=2) + '\n')
    user_id = login['user']['id'].replace("'", "''")
    try:
        sql(f"UPDATE frontend.\"user\" SET role='viewer' WHERE id='{user_id}'")
        request('oauth_downgraded_write', origin + '/api/connections', 403,
                dict(connection={'database': 'must-not-exist'}), token=access)
        request('oauth_downgraded_read', origin + '/api/connections', 200, token=access)
    finally:
        sql(f"UPDATE frontend.\"user\" SET role='admin' WHERE id='{user_id}'")
    client_id = registration['client_id'].replace("'", "''")
    original_expiry = sql(f"SELECT \"expiresAt\" FROM frontend.\"oauthAccessToken\" WHERE \"clientId\"='{client_id}'")
    try:
        sql(f"UPDATE frontend.\"oauthAccessToken\" SET \"expiresAt\"=TIMESTAMP '2000-01-01' WHERE \"clientId\"='{client_id}'")
        request('expired_oauth_userinfo', origin + '/api/auth/oauth2/userinfo', 401, token=access)
        request('expired_oauth_mcp', mcp + '/mcp', 401, initialize, token=access)
    finally:
        sql(f"UPDATE frontend.\"oauthAccessToken\" SET \"expiresAt\"=TIMESTAMP '{original_expiry}' WHERE \"clientId\"='{client_id}'")
    request('restored_oauth_mcp', mcp + '/mcp', 200, initialize, token=access)
    try:
        subprocess.run(docker + ['stop', 'frontend'], check=True, capture_output=True)
        request('authorization_server_outage', mcp + '/mcp', 500, initialize, token=access)
    finally:
        subprocess.run(docker + ['start', 'frontend'], check=True, capture_output=True)
        deadline = time.monotonic() + 30
        while True:
            try:
                with build_opener().open(origin, timeout=1) as response:
                    if response.status < 500:
                        break
            except (URLError, TimeoutError, RemoteDisconnected, ConnectionResetError):
                if time.monotonic() >= deadline:
                    raise
    request('authorization_server_recovered', mcp + '/mcp', 200, initialize, token=access)
    request('revoke_access', origin + '/api/auth/oauth2/revoke', 200,
            dict(token=access, client_id=registration['client_id'], token_type_hint='access_token'), form=True)
    request('revoked_userinfo', origin + '/api/auth/oauth2/userinfo', 401, token=access)
    request('revoked_mcp', mcp + '/mcp', 401, initialize, token=access)
    request('reused_code_denied', origin + '/api/auth/oauth2/token', 400, exchange, form=True)
    print(json.dumps(dict(checks=len(checks), passed=all(row['passed'] for row in checks))))


if __name__ == '__main__':
    main()
