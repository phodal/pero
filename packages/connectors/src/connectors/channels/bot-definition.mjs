import { channelFields as channels } from '../channel-fields.mjs';
export const BOT_CHANNEL_IDS = Object.freeze(['slack', 'teams', 'discord', 'dingtalk']);
export const botChannelId = transport => BOT_CHANNEL_IDS.find(id => channels[id].transport === transport);
const fail = () => { throw Object.assign(new Error('MCP_CONFIG'), { code: 'MCP_CONFIG' }); };
const reference = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function validateBotChannel(value) {
  const id = botChannelId(value?.transport);
  if (!id) fail();
  const fields = channels[id];
  const allowed = new Set(['transport', 'tools', ...fields.requires.map(field => field.key)]);
  if (Object.keys(value).some(key => !allowed.has(key))) fail();
  if (!Array.isArray(value.tools) || new Set(value.tools).size !== value.tools.length || value.tools.some(name => !fields.operations.some(op => op.tool === name))) fail();
  for (const field of fields.requires) {
    const input = value[field.key];
    if (input === undefined) { if (field.required) fail(); continue; }
    if (field.kind === 'secretRef') {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.secretRef !== 'string' || !reference.test(input.secretRef)) fail();
    } else if (typeof input !== 'string' || !input.trim() || Buffer.byteLength(input) > 4096 || /[\0\r\n]/.test(input)) fail();
  }
  for (const key of ['allowedUserIds', 'allowedConversationIds']) {
    if (value[key] === undefined) continue;
    const ids = value[key].split(',').map(id => id.trim()).filter(Boolean);
    if (!ids.length || ids.length > 512 || ids.some(id => Buffer.byteLength(id) > 512)) fail();
  }
  if (id === 'teams') {
    const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    if (!uuid.test(value.appId) || !uuid.test(value.tenantId)) fail();
    if (value.listenAddress !== undefined) {
      const match = /^(?:127\.0\.0\.1|\[::1\]):([0-9]{1,5})$/.exec(value.listenAddress);
      if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) fail();
    }
  }
  return value;
}
