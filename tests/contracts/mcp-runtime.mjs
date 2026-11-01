// Pure Host wire-contract checks; no Agent, MCP connection or process is started.
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with { type: 'json' };
const ajv = new Ajv2020({ strict: true, strictTypes: false });
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/McpRuntimeEvent`);
const event = {
  version: 1, kind: 'mcp_runtime', request_id: null, text: '', thread_id: 'thread',
  data: { incarnation: 1, agent_id: 'agent', thread_id: 'thread', session_id: 'session', revision: 2,
    observable: true, closed: false, servers: [{ server: 'docs', generation: 1, status: 'connected', tools: ['lookup'] }] },
};
for (const status of ['connecting', 'connected', 'disconnected', 'error', 'closed']) {
  event.data.servers[0].status = status;
  assert(validate(event), ajv.errorsText(validate.errors));
}
assert(validate({ ...event, data: { ...event.data, observable: false, session_id: null, servers: [] } }));
assert(validate({ ...event, data: { ...event.data, closed: true, session_id: null, servers: [] } }));
for (const field of ['env', 'headers', 'transport', 'error']) {
  assert(!validate({ ...event, data: { ...event.data, [field]: 'private' } }), `reject unexpected ${field}`);
}
assert(!validate({ ...event, data: { ...event.data, servers: [{ ...event.data.servers[0], status: 'online' }] } }));
assert(!validate({ ...event, data: { ...event.data, revision: 1.5 } }));
console.log('MCP runtime wire-contract checks passed (no connectivity claimed).');
