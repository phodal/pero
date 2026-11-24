// macOS manual acceptance for the Native GPUI Notebook Inspector tool row.
// This script does not launch the shell and does not record a pass.
const darwin = process.platform === 'darwin';
const lines = [
  'Native GPUI Notebook Inspector acceptance is manual.',
  darwin
    ? 'This machine is macOS. Build and open the shell, then record one conclusion.'
    : `This machine is ${process.platform}. scripts/dev/native.mjs refuses to launch the Native shell here, so this run does not verify it.`,
  '',
  'Build and open, from the repository root, with the pinned gpui-kit checkout:',
  '  PERO_GPUI_KIT_PATH=/path/to/gpui-kit npm run dev:native',
  'Use the same loopback agent and Notebook MCP server as scripts/test/mcp-notebook-conversation.mjs.',
  'Send: Open the pinned Notebook revision in the Inspector.',
  'Approve the Host ask. Do not use the tools/resources picker.',
  '',
  'Record exactly one conclusion:',
  '  usable — the fixed revision Inspector is interactive in the original tool row; close/reopen does not call the tool again.',
  '  degraded — the saved revision text is visible, but the Inspector cannot be driven.',
  '  not interactive — the row has no usable Notebook view.',
  'Keep a screenshot with that conclusion. Do not mark the fitness record verified until that observation exists.',
];
console.log(lines.join('\n'));
process.exit(2);
