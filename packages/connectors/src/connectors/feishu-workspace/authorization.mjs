import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createCliRunner, safeIdentity } from './client.mjs';

import { FEISHU_CAPABILITY_SCOPES } from './capabilities.mjs';
export { FEISHU_CAPABILITY_SCOPES };
const fail=code=>{throw Object.assign(new Error(code),{code})};
/** Device-flow secrets stay in Host memory; tokens stay in the official CLI.
 * No Point-side confirmation: begin() is reached only from the user's click in
 * the in-page connector dialog, and consent itself happens on open.feishu.cn. */
export class FeishuAuthorization {
  constructor({root,definition,openExternal}){Object.assign(this,{root,definition,openExternal});this.attempts=new Map();this.lifetime=new AbortController();}
  async begin(connectionId,capabilities){
    if(this.lifetime.signal.aborted)fail('FEISHU_CANCELLED');
    if(!Array.isArray(capabilities)||!capabilities.length||capabilities.length>Object.keys(FEISHU_CAPABILITY_SCOPES).length||new Set(capabilities).size!==capabilities.length||capabilities.some(c=>!Object.hasOwn(FEISHU_CAPABILITY_SCOPES,c)))fail('FEISHU_ARGUMENT');
    const definition=await this.definition(connectionId),env=definition.env;
    const run=createCliRunner({binary:env.POINT_FEISHU_CLI,sha256:env.POINT_FEISHU_CLI_SHA256,home:env.HOME,profile:env.POINT_FEISHU_PROFILE});
    let existing=[];try{const current=safeIdentity(await run(['auth','status','--json','--verify'],{signal:this.lifetime.signal}));if(current.appId===env.POINT_FEISHU_APP_ID)existing=current.scopes}catch{}
    const scopes=[...new Set([...existing,...FEISHU_CAPABILITY_SCOPES.documents,...capabilities.flatMap(c=>FEISHU_CAPABILITY_SCOPES[c])])];
    const result=await run(['auth','login','--scope',scopes.join(' '),'--no-wait','--json'],{signal:this.lifetime.signal});
    const data=result.data??result;
    const authorizationUrl=data.verification_url??data.verification_uri_complete;
    const deviceCode=data.device_code;
    let url;try{url=new URL(authorizationUrl)}catch{fail('FEISHU_AUTH_REQUIRED')}
    if(url.protocol!=='https:'||url.origin!=='https://open.feishu.cn'||url.username||url.password||typeof deviceCode!=='string'||deviceCode.length>4096)fail('FEISHU_AUTH_REQUIRED');
    await mkdir(this.root,{recursive:true,mode:0o700});const temp=await mkdtemp(join(this.root,'qr-'));
    let qr;try{
      const qrRun=createCliRunner({binary:env.POINT_FEISHU_CLI,sha256:env.POINT_FEISHU_CLI_SHA256,home:env.HOME,cwd:temp,profile:env.POINT_FEISHU_PROFILE});
      await qrRun(['auth','qrcode',authorizationUrl,'--output','authorization.png'],{mode:'discard',signal:this.lifetime.signal});
      qr='data:image/png;base64,'+(await readFile(join(temp,'authorization.png'))).toString('base64');
    }finally{await rm(temp,{recursive:true,force:true})}
    const attemptId=randomUUID();
    if(this.lifetime.signal.aborted)fail('FEISHU_CANCELLED');
    this.attempts.set(connectionId,{definition:JSON.stringify(definition),attemptId,deviceCode,scopes,run,appId:env.POINT_FEISHU_APP_ID,expiresAt:Date.now()+Math.min(Number(data.expires_in??600),600)*1000});
    const publicAttempt={attemptId,authorizationUrl,qr,capabilities,expiresAt:new Date(this.attempts.get(connectionId).expiresAt).toISOString()};
    this.attempts.get(connectionId).publicAttempt=publicAttempt;
    await this.openExternal(authorizationUrl);
    return publicAttempt;
  }
  async finish(connectionId,attemptId){
    const attempt=this.attempts.get(connectionId);
    if(!attempt||attempt.attemptId!==attemptId||attempt.expiresAt<Date.now())fail('FEISHU_AUTH_EXPIRED');
    if(JSON.stringify(await this.definition(connectionId))!==attempt.definition){this.attempts.delete(connectionId);fail('FEISHU_ACCOUNT_CHANGED')}
    await attempt.run(['auth','login','--device-code',attempt.deviceCode,'--json'],{signal:this.lifetime.signal});
    const account=safeIdentity(await attempt.run(['auth','status','--json','--verify'],{signal:this.lifetime.signal}));
    if(account.appId!==attempt.appId||!attempt.scopes.every(scope=>account.scopes.includes(scope)))fail('FEISHU_PERMISSION');
    this.attempts.delete(connectionId);return account;
  }
  status(connectionId){const attempt=this.attempts.get(connectionId);if(attempt?.expiresAt<Date.now()){this.attempts.delete(connectionId);return {expired:true}}return {attempt:attempt?.publicAttempt??null}}
  cancel(connectionId){this.attempts.delete(connectionId);return {cancelled:true};}
  dispose(){this.lifetime.abort();this.attempts.clear();}
}
