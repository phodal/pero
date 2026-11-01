"""Authenticated bounded Host App API; no device or arbitrary-code route."""
import hmac
from http.server import BaseHTTPRequestHandler
import json
import re
from experiments import canonical, digest


def agent_summary(record):
    if 'trials' not in record or 'initial_state' not in record: return record
    return {**record, 'trials': [{**trial, 'events': [
        {**{key:value for key,value in event.items() if key not in ('before','after','backend')},
         'before_hash':digest(event['before']), 'after_hash':digest(event['after']) if event['after'] else None,
         'backend': {key:event['backend'][key] for key in ('backend','version','mode')} if event['backend'] else None}
        for event in trial['events']]} for trial in record['trials']],
        'evidence_path':f"/api/experiments/{record['id']}/export", 'view':'agent-summary'}


def handler(store, secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass

        def reply(self,code,value):
            if isinstance(value,dict) and 'error' in value and 'detail' not in value:
                value['detail']=value['error']+(f" (step {value['step_index']+1})" if value.get('step_index') is not None else '')
            raw=canonical(value)
            self.send_response(code)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)

        def dispatch(self):
            try:
                if not secret or not hmac.compare_digest(secret,self.headers.get('X-Pero-App-Token','')):
                    return self.reply(401,{'error':'Host authentication required'})
                self.connection.settimeout(15)
                if self.headers.get('Transfer-Encoding'): raise ValueError('Transfer encoding unsupported')
                if self.command=='GET':
                    if self.path=='/api/state': return self.reply(200,store.listing())
                    match=re.fullmatch(r'/api/experiments/([a-f0-9]{32})(/export)?',self.path)
                    if match: return self.reply(200,store.export(match[1]) if match[2] else store.read(match[1]))
                elif self.command=='POST':
                    if not self.headers.get('Content-Type','').startswith('application/json'): raise ValueError('JSON content type required')
                    length=int(self.headers.get('Content-Length',0))
                    if not 0<length<=131072: raise ValueError('Request must be 1–131072 bytes')
                    raw=self.rfile.read(length)
                    if len(raw)!=length: raise ValueError('Incomplete request')
                    data=json.loads(raw,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON number')))
                    if not isinstance(data,dict): raise ValueError('Object required')
                    if self.path=='/api/experiments': return self.reply(201,store.create(data))
                    if self.path=='/api/agent-step':
                        action=data.get('action')
                        fields={'read':set(),'propose':{'protocol','parentTrialId','reason'},'validate':{'trialId'},'simulate':{'trialId'},'observe':{'trialId'},'evaluate':{'trialId'},'cancel':{'trialId'},'compare':set()}
                        if not isinstance(action,str) or action not in fields or set(data)-({'action','experimentId'}|fields[action]): raise ValueError('Unsupported action or fields')
                        identity=data.get('experimentId'); trial=data.get('trialId')
                        if action=='read': result=store.read(identity)
                        elif action=='propose': result=store.propose(identity,data.get('protocol'),data.get('parentTrialId'),data.get('reason','Initial candidate'))
                        elif action=='simulate': result=store.start(identity,trial)
                        elif action=='compare': result=store.compare(identity)
                        else: result=getattr(store,action)(identity,trial)
                        return self.reply(200,agent_summary(result))
                    match=re.fullmatch(r'/api/experiments/([a-f0-9]{32})/(propose|validate|simulate|observe|evaluate|compare|cancel)',self.path)
                    if match:
                        action,identity=match[2],match[1]
                        allowed={'propose':{'protocol','parentTrialId','reason'},'compare':set()}.get(action,{'trialId'})
                        if set(data)-allowed: raise ValueError('Unsupported action fields')
                        if action=='propose': result=store.propose(identity,data.get('protocol'),data.get('parentTrialId'),data.get('reason','Initial candidate'))
                        elif action=='compare': result=store.compare(identity)
                        elif action=='simulate': result=store.start(identity,data.get('trialId'))
                        else: result=getattr(store,action)(identity,data.get('trialId'))
                        return self.reply(200,result)
                    match=re.fullmatch(r'/api/experiments/([a-f0-9]{32})/(import|review)',self.path)
                    if match:
                        result=store.import_observation(match[1],data) if match[2]=='import' else store.review(match[1],data)
                        return self.reply(200,result)
                return self.reply(404,{'error':'Route not found'})
            except OSError:
                return self.reply(500,{'error':'Local evidence I/O failed; check the App data directory'})
            except (ValueError,KeyError,TypeError,OverflowError) as error:
                return self.reply(400,{'error':str(error),'code':getattr(error,'code','invalid'),'step_index':getattr(error,'step_index',None)})
        do_GET=dispatch
        do_POST=dispatch
    return Handler
