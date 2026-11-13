import React, { useState } from 'react';
import { useNavigate } from '@pero/app-sdk';
import { Button, ContentSection, Disclosure, EnvironmentInspector, Feedback, MetadataList } from '@pero/app-sdk/ui';
import type { Translate } from '../messages';
import type { useTaskPackage } from '../use-task-package';

export function TaskPackagePanel({ task, inputId, running, t }: {
  task: ReturnType<typeof useTaskPackage>; inputId?: string; running: boolean; t: Translate;
}) {
  const declaration = task.taskPackage, model = task.model;
  const navigate = useNavigate(), [navigationError, setNavigationError] = useState('');
  const prepared = model?.status === 'ready' && model.inputId === inputId;
  const stopped = model?.status === 'stopped';
  const prepare = stopped || model?.status === 'failed';
  return <ContentSection id="virtual-cell-task-package" title={t('taskPackage')}>
    <div>
      <EnvironmentInspector targets={['virtual-cell.comparison']} />{' '}
      <Button variant="ghost" onClick={() => { setNavigationError(''); void Promise.resolve(navigate('/apps/environments')).catch(error => setNavigationError(error instanceof Error ? error.message : String(error))); }}>{t('taskManageEnvironment')}</Button>
    </div>
    {navigationError && <Feedback kind="error">{navigationError}</Feedback>}
    {task.error && <Feedback kind="error">{task.error} <Button variant="ghost" onClick={task.refresh}>{t('refresh')}</Button></Feedback>}
    {!declaration && !task.error && <p role="status">{t('busy')}</p>}
    {declaration && <>
      <MetadataList items={[
        { id: 'version', label: t('taskPackageVersion'), value: `${declaration.id} (${declaration.version})` },
        { id: 'methods', label: t('comparisonMethods'), value: declaration.methods.map(method => `${method.id} (${method.version})`).join(', ') },
        { id: 'environment', label: t('taskEnvironment'), value: `Python ${declaration.environment.python} · ${declaration.environment.execution.toUpperCase()}` },
      ]}/>
      <p className="vc-muted">{declaration.environment.dependencies.length ? declaration.environment.dependencies.join(', ') : t('taskDependencies')}. {t('taskBaselineNote')}</p>
      <Disclosure summary={t('taskPackageDetails')}>
        <MetadataList layout="stacked" items={[
          { id: 'digest', label: 'SHA-256', value: declaration.digest, format: 'code' },
          { id: 'inputs', label: t('taskInputs'), value: Object.entries(declaration.inputs).map(([name, value]) => <div key={name}>{name}: {value}</div>) },
          { id: 'outputs', label: t('taskOutputs'), value: declaration.outputs.join('; ') },
          { id: 'checks', label: t('taskChecks'), value: declaration.checks.join('; ') },
          { id: 'skill', label: t('taskSkill'), value: `${declaration.skill.id} (${declaration.skill.version}) · ${declaration.skill.entry}` },
        ]}/>
      </Disclosure>
    </>}
    <ContentSection id="virtual-cell-model-endpoint" title={t('endpointTitle')} actions={model && <>
      {prepare && <Button variant="ghost" disabled={task.disabled || running || !inputId} onClick={() => void task.request('start', inputId)}>{task.pending === 'start' ? t('endpoint_starting') : t('endpointStart')}</Button>}
      {!stopped && <Button variant="ghost" disabled={task.disabled || running || model.status === 'in_use' || model.status === 'starting' || model.status === 'stopping'} onClick={() => void task.request('stop')}>{task.pending === 'stop' ? t('endpoint_stopping') : t(model.source === 'remote' ? 'endpointDisconnect' : model.status === 'failed' ? 'endpointReset' : 'endpointStop')}</Button>}
    </>}>
      {model && <>
        <p role="status">{t(`endpoint_${model.status}`)} · {t(model.source === 'local' ? 'endpointLocal' : 'endpointRemote')} · {t('endpointUses')}: {model.uses}</p>
        <MetadataList items={[{ id: 'model', label: t('model'), value: `${model.model.id} (${model.model.version})` }]}/>
        {model.error && !task.error && <Feedback kind="error">{model.error}</Feedback>}
        <p className="vc-muted">{running ? t('endpointStopAfterRun') : prepared ? t('endpointPrepared') : model.inputId && model.inputId !== inputId ? t('endpointDifferentInput') : stopped ? t('endpointOptional') : ''}</p>
      </>}
    </ContentSection>
  </ContentSection>;
}
