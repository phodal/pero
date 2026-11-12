#!/usr/bin/env node
// Opt-in Beta check for a real provider. Without PERO_BETA_LIVE=1 and
// DEEPSEEK_API_KEY this process exits 2. That is not a pass.
//
// A local macOS or Windows agent can run the installed app beside this check:
// 1. Install the dated prerelease for that OS. Do not replace an existing profile;
//    use a fresh data directory.
// 2. Export DEEPSEEK_API_KEY in the shell. Do not print it.
// 3. PERO_BETA_LIVE=1 node scripts/ci/beta-provider-preflight.mjs
// 4. In the app, save the same provider, open one project session, ask for one
//    existing tool, confirm the Host permission prompt, save a Notebook entry
//    that cites a Data record, quit, relaunch, and confirm the entry is still there.
// 5. Stop a tool once and confirm the error can be retried without deleting the note.
// Record the OS, the package SHA-256, and whether the GUI steps were actually done.
if (process.env.PERO_BETA_LIVE !== '1' || !process.env.DEEPSEEK_API_KEY) {
  console.error('Beta provider acceptance needs PERO_BETA_LIVE=1 and DEEPSEEK_API_KEY in the environment. This is not a pass.');
  process.exit(2);
}
const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
console.log(JSON.stringify({ ready: true, model, credential: 'present' }));
