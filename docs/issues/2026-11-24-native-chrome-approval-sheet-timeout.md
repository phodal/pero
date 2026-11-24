---
kind: issue
status: open
date: 2026-11-24
updated: 2026-11-24
---

# Native Chrome acceptance waits for its first approval sheet

The signed Native probe pairs the fixture Chrome extension and reports
`Connected`. The test then times out while looking for the first diagnostics
approval sheet on the probe's window. The probe is still running when the test
terminates it and has produced no conversation report.

The timeout occurred with extension 0.3.16 in the iframe capture scenario and
the ordinary CDP scenario. The same ordinary scenario using the test script
from `d122ea9d3` and the previously accepted signed 0.3.15 probe also timed out
at the first sheet on this machine. These runs establish a failure of the
current approval acceptance lane. The cause still needs a readiness or window
state trace from the Native probe.

The ordinary 0.3.16 DMG passed mounted signature verification and portable
startup. The Electron and headed Chrome suites verified iframe network capture
end to end. The Native acceptance entry is
`tests/e2e/native-chrome-site-tools.mjs --cdp-target-network` with
`PERO_NATIVE_REPL_INSTALLED_APP` pointing to the signed probe.
