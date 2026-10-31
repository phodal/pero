"""Authenticated bounded App transport. Every route calls the same domain operations."""
import hmac
from http.server import BaseHTTPRequestHandler
import json
import re

from .experiments import Goal, Invalid, TEMPLATES, canonical
from . import engines


def handler(store, secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, code, value):
            body = canonical(value)
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def action(self, action, identity, data):
            if action == 'read': return store.read(identity)
            if action == 'propose': return store.propose(identity,data.get('parameters'))
            if action == 'search': return store.start(identity, 'search', data.get('budget'))
            if action == 'verify': return store.start(identity, 'verify')
            if action == 'cancel': return store.cancel(identity)
            if action == 'lock': return store.lock_candidate(identity, data.get('candidateId'))
            if action == 'reevaluate': return store.reevaluate(identity)
            raise Invalid('Unknown experiment action')

        def dispatch(self):
            try:
                if self.headers.get('Transfer-Encoding'):
                    raise Invalid('Transfer encoding is unsupported')
                if not secret or not hmac.compare_digest(secret, self.headers.get('X-Pero-App-Token','')):
                    return self.reply(401, dict(error='Host authentication required',detail='Host authentication required'))
                self.connection.settimeout(15)
                if self.command == 'GET':
                    if self.path == '/api/templates':
                        return self.reply(200,dict(templates=[t.to_dict() for t in TEMPLATES],capabilities=engines.capabilities()))
                    if self.path == '/api/experiments': return self.reply(200,store.listing())
                    match = re.fullmatch(r'/api/experiments/([a-f0-9]{32})(/export)?', self.path)
                    if match:
                        record = store.read(match[1])
                        return self.reply(200,store.export(match[1]) if match[2] else record)
                if self.command == 'POST':
                    if not self.headers.get('Content-Type','').startswith('application/json'):
                        raise Invalid('JSON content type is required')
                    length = int(self.headers.get('Content-Length',0))
                    if not 0 < length <= 65536:
                        raise Invalid('JSON request must be between 1 and 65536 bytes')
                    raw = self.rfile.read(length)
                    if len(raw)!=length: raise Invalid('Incomplete request')
                    data = json.loads(raw)
                    if not isinstance(data,dict): raise Invalid('Request must be a JSON object')
                    if self.path == '/api/experiments': return self.reply(201,store.create(data))
                    if self.path == '/api/agent-step':
                        fields = {'read': set(), 'search': set(), 'propose': {'parameters'},
                                  'cancel': set(), 'lock': {'candidateId'}, 'verify': set(), 'reevaluate': set()}
                        action = data.get('action')
                        if not isinstance(action, str) or action not in fields: raise Invalid('Unknown Agent action')
                        goal = Goal(data.get('experimentId'), data.get('specHash'))
                        if set(data)-({'action','experimentId','specHash'} | fields[action]):
                            raise Invalid('Unknown Agent request field')
                        with store.lock:
                            goal.require_record(store.get_record(goal.experiment_id))
                            result = self.action(action,goal.experiment_id,data)
                        return self.reply(200,result)
                    match = re.fullmatch(r'/api/experiments/([a-f0-9]{32})/(search|verify|cancel|lock|reevaluate|propose)',self.path)
                    if match:
                        allowed = {'search':{'budget'},'lock':{'candidateId'},'propose':{'parameters'}}.get(match[2],set())
                        if set(data)-allowed: raise Invalid('Unknown action parameter')
                        return self.reply(200,self.action(match[2],match[1],data))
                return self.reply(404,dict(error='Route not found',detail='Route not found'))
            except OSError:
                return self.reply(500,dict(error='Local evidence I/O failed',detail='Local evidence could not be read or saved; check the App data directory and retry.'))
            except (Invalid,ValueError,KeyError,TypeError) as error:
                return self.reply(400,dict(error=str(error),detail=str(error)))

        do_GET = dispatch
        do_POST = dispatch
    return Handler
