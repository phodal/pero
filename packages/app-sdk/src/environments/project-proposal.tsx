import React, { useState } from 'react';
import type { EnvironmentProposal } from '../../../../protocol/generated/host';
import { Button } from '../components/button';
import { Disclosure } from '../components/disclosure';
import { Field } from '../components/field';
import { Input } from '../components/input';
import { Feedback } from '../components/feedback';
import { ContentSection } from '../../../pero-design/src/content';

export function ProjectProposal({locale, fetchFn}: {locale:string;fetchFn:typeof fetch}) {
  const zh=locale.startsWith('zh');
  const [source,setSource]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [proposal,setProposal]=useState<EnvironmentProposal|null>(null);
  const inspect=async(form:HTMLFormElement)=>{
    if(busy || !form.reportValidity())return;
    setBusy(true);setError('');
    try {
      const response=await fetchFn('/host/environment/profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'propose',source})});
      if(!response.ok)throw Error((await response.text()).slice(0,1000));
      setProposal(await response.json());
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  };
  return <Disclosure summary={zh?'检查项目环境声明':'Review project declarations'}>
    <form className="env-create-form" onSubmit={event=>{event.preventDefault();void inspect(event.currentTarget);}}>
      <Field label={zh?'项目目录或固定提交的 GitHub URL':'Project directory or GitHub URL pinned to a commit'} controlId="environment-source">{control=><Input {...control} required maxLength={2048} value={source} disabled={busy} onChange={event=>setSource(event.target.value)} placeholder="https://github.com/owner/repo/tree/FULL_COMMIT"/>}</Field>
      <p className="env-note">{zh?'读取 pyproject.toml、uv.lock、.python-version 和 requirements.txt，生成待审核提案。此操作不安装依赖，也不运行项目代码。':'Read pyproject.toml, uv.lock, .python-version and requirements.txt into a review proposal. This does not install dependencies or execute project code.'}</p>
      <Button type="submit" busy={busy} onClick={event=>{event.preventDefault();void inspect(event.currentTarget.form!);}}>{zh?'生成审核提案':'Inspect declarations'}</Button>
    </form>
    {error&&<Feedback kind="error" variant="block">{error}{proposal&&(zh?' 保留上次成功的提案。':' Showing the previous successful proposal.')}</Feedback>}
    {proposal&&<section aria-label={zh?'待审核环境提案':'Environment proposal for review'}>
      <ContentSection id="env-proposal" title={zh?'待审核':'Review required'}><p>{proposal.source}</p>
      <dl className="env-observation"><dt>{zh?'Python 声明':'Python declarations'}</dt><dd>{proposal.python_requests.join(' · ')||'—'}</dd>
        <dt>{zh?'直接依赖':'Declared dependencies'}</dt><dd>{proposal.dependencies.map(value=><div key={value}>{value}</div>)}</dd>
        <dt>{zh?'锁定包记录数':'Locked package records'}</dt><dd>{proposal.locked_packages}</dd></dl>
      <ul>{proposal.warnings.map(value=><li key={value}>{value}</li>)}</ul>
      <Disclosure summary={zh?'声明文件与提案摘要':'Declaration and proposal digests'}><dl className="env-observation">{proposal.declarations.map(value=><React.Fragment key={value.name}><dt>{value.name}</dt><dd>{value.sha256}</dd></React.Fragment>)}<dt>SHA-256</dt><dd>{proposal.digest}</dd></dl></Disclosure>
      </ContentSection>
    </section>}
  </Disclosure>;
}
