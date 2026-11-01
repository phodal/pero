import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AppParameterSchema } from '../../../packages/app-sdk/src/app-use.ts';
import { exampleProtocol } from '../ui-src/presentation.ts';

test('real Lab manifest schemas admit bounded proposals, never review or policy writes', () => {
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const routes = app.contributes.writes;
  assert.deepEqual(routes.map(route => route.name), ['experiment-step', 'propose-protocol']);
  const step = AppParameterSchema.parse(routes[0].schema), propose = AppParameterSchema.parse(routes[1].schema);
  const experimentId = 'a'.repeat(32), trialId = 'b'.repeat(32);
  for (const action of ['read','validate','simulate','observe','evaluate','compare','cancel'])
    assert.doesNotThrow(() => step.validate({ action, experimentId, trialId }));
  const valid = { action:'propose', experimentId, protocol:exampleProtocol(), reason:'Baseline' };
  assert.doesNotThrow(() => propose.validate(valid));
  assert.doesNotThrow(() => propose.validate({ ...valid, parentTrialId:trialId }));
  for (const action of ['create','review','execute_hardware','run_python']) assert.throws(() => step.validate({action,experimentId}));
  for (const extra of [{criteria:{}},{max_trials:100},{initial_state:{}},{accepted:true}])
    assert.throws(() => propose.validate({...valid,...extra}));
  assert.throws(() => propose.validate({...valid,protocol:{...valid.protocol,steps:[{op:'python',resource:'A1'}]}}));
});
