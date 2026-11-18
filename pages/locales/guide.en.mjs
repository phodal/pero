import paper from './guide-paper.en.mjs';
import research from './guide-research.en.mjs';
import runtime from './guide-runtime.en.mjs';

export default {
  overview: {
    title: 'Pero documentation',
    label: 'Overview',
    description: 'Read papers, inspect data, and record your research in one desktop workbench. Trace results back to their sources and recorded runs.',
    sections: [
      {
        id: 'where-to-run',
        title: 'Choose where to run Pero',
        body: `
          <p>Follow the tutorials in the <strong>Electron desktop workbench</strong>. You can read and annotate PDFs, inspect local data, and save notes on your computer. Configure a model provider when you want an Agent to analyze something. Set up a Compute connection when a method needs to run on another machine.</p>
          <p>The <a href="../#distributed">interactive website demo</a> shows task assignment and result review with example data and simulated roles. The <a href="https://openpero.com/workbench/">browser workbench preview</a> shows the interface. Local Agents and research Apps require the desktop Host.</p>`,
      },
      {
        id: 'continue-your-research',
        title: 'Continue by research task',
        body: `
          <ul>
            <li>Use <a href="{{data}}">Data</a> and six sample records to import a file, filter rows, save a view, and check a version.</li>
            <li>Use <a href="{{notebook}}">Notebook</a> to save a revision with your observations and sources, then reopen or export it.</li>
            <li>Use <a href="{{projects}}">Projects</a> to record a goal and link existing papers, research reports, and experiments.</li>
            <li>Use <a href="{{compute}}">Compute</a> to identify the dependencies and execution location, then inspect the job status, logs, and artifacts.</li>
            <li><a href="{{reference}}#read-a-result">Assess what a result supports</a> by checking sources, run records, independent verification, and researcher review.</li>
          </ul>`,
      },
    ],
  },
  install: {
    title: 'Install and launch',
    label: 'Install and launch',
    description: 'Choose a desktop package for your system, verify the download, and prepare your first App. Build from source to try newer features.',
    sections: [
      {
        id: 'download',
        title: 'Choose a release and desktop package',
        body: `
          <p>Open the development preview you want on <a href="https://github.com/phodal/pero/releases">GitHub Releases</a>. The filenames below are from the <a href="https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261112">November 12, 2026 preview</a>. Features marked as current source may be newer than your package. Consult its release notes.</p>
          <table>
            <thead><tr><th scope="col">Platform</th><th scope="col">Electron workbench</th><th scope="col">How to launch</th></tr></thead>
            <tbody>
              <tr><th scope="row">macOS Apple Silicon</th><td><code>Pero-macos-arm64.dmg</code></td><td>Open the DMG, drag <code>Pero.app</code> to Applications, and launch it from there.</td></tr>
              <tr><th scope="row">Windows x64</th><td><code>Pero-windows-x64.zip</code></td><td>Extract the whole archive into one directory, then open <code>Pero.exe</code>.</td></tr>
              <tr><th scope="row">Linux x64</th><td><code>Pero-linux-x64.tar.gz</code></td><td>Extract the archive and run <code>./pero</code> in the app directory. Your system needs the Electron desktop libraries.</td></tr>
            </tbody>
          </table>
          <p>The same release offers a separate Native package for macOS Apple Silicon. Electron and Native use separate profiles. This guide uses Electron for first launch. The macOS packages are ad-hoc signed and unnotarized. Windows and Linux development packages are unsigned. If your system blocks launch, verify the download source and consult the release notes.</p>`,
      },
      {
        id: 'verify-download',
        title: 'Verify the downloaded file',
        body: `
          <p>Download <code>SHA256SUMS</code> from the same release. Run the command for your system from the download directory. Compare the full digest with the entry for the <strong>same archive filename</strong>.</p>
          <pre><code># macOS
shasum -a 256 Pero-macos-arm64.dmg

# Windows PowerShell
Get-FileHash .\\Pero-windows-x64.zip -Algorithm SHA256

# Linux
sha256sum Pero-linux-x64.tar.gz</code></pre>
          <p>If the digests match, continue with extraction or installation. If they differ, download the file again from the release and verify it. The build metadata identifies the source commit and target platform.</p>`,
      },
      {
        id: 'prepare-environment',
        title: 'Launch and prepare the first App',
        body: `
          <ol>
            <li>Open the Electron workbench and choose <strong>Papers</strong> in the sidebar. If the App reports a missing environment, choose <strong>Prepare environment</strong>.</li>
            <li>First-time preparation may download uv, CPython 3.12, and the App’s pinned dependencies. Wait for the environment to report ready. The default directory in a fresh profile is <code>~/.pero/environment/pero-python312</code>. An existing profile keeps its selected environment.</li>
            <li>Open a selectable-text PDF and save a highlight to check that the reader works and saves annotations. Follow the <a href="{{paper}}#import-and-highlight">first paper tutorial</a>. Importing and reading a local PDF requires no model account, Task Center login, or PostgreSQL.</li>
          </ol>
          <p>For offline use, follow the <a href="https://github.com/phodal/pero/blob/master/DEVELOPMENT.md#python-environments-and-advanced-overrides">pre-provisioned environment instructions</a> to configure an absolute venv directory with its dependencies installed. See <a href="{{compute}}">Compute and environments</a> for preparation, inspection, and binding.</p>`,
      },
      {
        id: 'startup-troubleshooting',
        title: 'Diagnose launch and preparation failures',
        body: `
          <dl>
            <dt>The application window never opens</dt><dd>Check the download digest, CPU architecture, and folder contents. On Linux, match any reported missing shared libraries to your distribution’s runtime dependencies.</dd>
            <dt>The workbench opens but an App reports a missing environment</dt><dd>Start preparation from the App prompt. If it fails, read the details to distinguish a failed download, an invalid existing environment, and a failed App startup. Reopen the App once the environment reports ready.</dd>
            <dt>An App, record, or setting appears to be missing</dt><dd>Confirm that you opened the intended Electron, Native, or development profile and that the feature shipped in your version. See the <a href="{{reference}}#data-and-cost">profile and data locations</a>.</dd>
            <dt>Preparation succeeded but the App still fails</dt><dd>In recent source builds, look for <code>app-startup.jsonl</code> next to the Host settings. Match the request ID from the interface to the startup stage, error code, and exit status. Include the shareable record if you file an issue.</dd>
          </dl>`,
      },
      {
        id: 'from-source',
        title: 'Launch from source',
        body: `
          <p>Check the system prerequisites in the <a href="https://github.com/phodal/pero/blob/master/DEVELOPMENT.md#desktop-from-source">development guide</a>. Current source uses Node.js 22.18+, Go 1.27.3, Rust stable, the Wasm target of <code>nightly-2026-10-28</code>, and a pinned GPUI Kit checkout. Run these POSIX shell commands from a clean Pero checkout, with no <code>gpui-kit</code> directory already beside it.</p>
          <pre><code>npm ci
node node_modules/electron/install.js
rustup toolchain install stable --profile minimal
rustup toolchain install nightly-2026-10-28 --profile minimal --target wasm32-unknown-unknown
git -c core.autocrlf=false clone https://github.com/longbridge/gpui-kit.git ../gpui-kit
git -C ../gpui-kit checkout --detach 7591a35eced761e3613c01e71ff04c10129dae1a
export PERO_GPUI_KIT_PATH="$(cd ../gpui-kit &amp;&amp; pwd)"
npm run dev</code></pre>
          <p>The first build may download Rust dependencies, fonts, Wasm tooling, and App dependencies. A successful build opens the Electron workbench. Use <code>npm run dev:paper</code> to try Paper in a separate profile. Use <code>npm start</code> to open existing workbench outputs after a build.</p>`,
      },
    ],
  },
  paper,
  ...research,
  ...runtime,
  reference: {
    title: 'Concepts, evidence, and troubleshooting',
    label: 'Concepts and reference',
    description: 'Find the right record, understand what a run can establish, and find where to investigate a problem.',
    sections: [
      {
        id: 'concepts',
        title: 'Objects and records in the workbench',
        body: `
          <table>
            <thead><tr><th scope="col">Object</th><th scope="col">What it records</th><th scope="col">Where to look</th></tr></thead>
            <tbody>
              <tr><th scope="row">Research project</th><td>A goal, optional local folder, and links to App records. Each App stores its own domain data.</td><td><a href="{{projects}}">Project overview and references</a></td></tr>
              <tr><th scope="row">Research App</th><td>Objects specific to the App, such as a paper snapshot, dataset file version, notebook revision, or experiment attempt.</td><td><a href="{{workflows}}">App workflows and source records</a></td></tr>
              <tr><th scope="row">Agent session</th><td>Messages, tool activity, and approvals. The local Host manages the session. You choose the Agent and workspace when it starts.</td><td><a href="{{agents}}">Conversation history and tools</a></td></tr>
              <tr><th scope="row">Computation attempt</th><td>The method, inputs, execution environment, and the status, logs, or artifacts of a specific attempt. Fields depend on the workflow.</td><td><a href="{{compute}}">Compute records</a> or the App that owns the experiment</td></tr>
              <tr><th scope="row">Shared task and Worker</th><td>The optional control plane coordinates shared tasks. An enrolled Worker executes in its configured environment.</td><td><a href="https://github.com/phodal/pero/blob/master/desktop/README.md#remote-tasks">Desktop remote tasks</a></td></tr>
            </tbody>
          </table>
          <p>For example, a project link to a Paper report opens the original in Paper. To record the data you reviewed at that point, note the exact Data file version or save a Notebook revision with a reference.</p>`,
      },
      {
        id: 'read-a-result',
        title: 'Trace a conclusion back to evidence',
        body: `
          <ol>
            <li><strong>Find the source.</strong> Follow a paper claim to the cited passage and check the context and units. For data, identify the exact file version, source, and SHA-256.</li>
            <li><strong>Find the run.</strong> Check the input, method version, parameters, and environment. Open the logs and artifacts from that attempt. Keep the earlier attempt available when you rerun for comparison.</li>
            <li><strong>Read the verification verdict.</strong> Check which output was evaluated, what rule was fixed before the run, and what an independent check recomputed. Record whether verification passed, found a mismatch, or was unavailable. A completed run establishes that the procedure ran.</li>
            <li><strong>State the scope.</strong> The <a href="{{workflows}}#recheck-a-result">Fisher example</a> checks one value in Table III. <code>REPRODUCED</code> applies to that value. The whole-paper verdict is <code>NOT_ASSESSED</code>.</li>
          </ol>
          <p>A useful record for Fisher (1936) names the Table III result, the 100 reviewed inputs, the expected 19.1434 cm², and the tolerance of 0.00005 cm². The exported verification report contains the independent check.</p>`,
      },
      {
        id: 'data-and-cost',
        title: 'Local data, permissions, and billing',
        body: `
          <ul>
            <li><strong>Settings and data.</strong> The default Electron workbench stores Host settings in <code>~/.pero/config/runtime-settings.json</code> and App records in <code>~/.pero/app-data/</code>. Conversation history is in <code>sessions.jsonl</code> in Electron’s user-data directory. Native, standalone products, and isolated development profiles use their own locations.</li>
            <li><strong>External requests.</strong> Reading a local file and running a local method can stay on your computer. Model requests, literature search, MCP, and shared task services may receive relevant questions, selected context, or tool arguments. Review drafts, attachments, and requested permissions before proceeding.</li>
            <li><strong>Billing.</strong> Model and compute charges come from the provider’s usage records. Workflow step and time limits govern that execution. The interface shows usage when usage data is available.</li>
          </ul>
          <p>Use App export actions to share research records. Dataset versions, notebook revisions, and run evidence have their own export formats and scopes.</p>`,
      },
      {
        id: 'verification-and-help',
        title: 'Read acceptance records and diagnose problems',
        body: `
          <p><strong>Identify where the failure occurred.</strong> Start with <a href="{{install}}#startup-troubleshooting">startup troubleshooting</a> if the workbench or an App cannot launch. For model errors, check <a href="{{agents}}">sign-in, credentials, and session settings</a>. When a submitted job produces no result, check <a href="{{compute}}">the connection, attempt state, logs, and artifacts</a>. If the conclusion is in question, follow the <a href="#read-a-result">source and verification checks</a>.</p>
          <p>The <a href="https://github.com/phodal/pero/blob/master/docs/fitness/README.md#acceptance-levels">acceptance levels</a> describe the conditions covered. L0 covers code and contract checks. L1 runs Desktop with an Agent fixture. L2 uses a real provider, environment, or service. L3 checks installation, upgrade, and operation of the signed package on the target system. Check the version, platform, sample, and remaining gaps in each record.</p>
          <p>When filing a <a href="https://github.com/phodal/pero/issues">GitHub issue</a>, include the version or commit SHA, OS and architecture, Electron or Native, steps, expected and observed results, and any shareable error or request ID.</p>`,
      },
      {
        id: 'developer-reference',
        title: 'Development and deployment',
        body: `
          <dl>
            <dt>Build Desktop and contribute changes</dt><dd>Follow <a href="{{install}}#from-source">source setup</a>. Use the <a href="https://github.com/phodal/pero/blob/master/CONTRIBUTING.md">contribution guide</a> and <a href="https://github.com/phodal/pero/blob/master/DEVELOPMENT.md#verification">verification commands</a> for the area you change.</dd>
            <dt>Develop an App</dt><dd>Start from an existing example under <code>apps/</code>. The <a href="https://github.com/phodal/pero/blob/master/apps/README.md">App development contract</a> covers the manifest, Web panels, backend, environment, and declared permissions.</dd>
            <dt>Deploy shared tasks</dt><dd>See <a href="https://github.com/phodal/pero/blob/master/server/README.md">control plane setup</a> for PostgreSQL, server configuration, and project access. Use the <a href="https://github.com/phodal/pero/blob/master/crates/pero-worker/README.md">Worker guide</a> to connect an execution machine.</dd>
            <dt>Look up boundaries and plans</dt><dd>See the <a href="https://github.com/phodal/pero/blob/master/docs/ARCHITECTURE.md">architecture</a>, <a href="https://github.com/phodal/pero/blob/master/docs/adr/README.md">decision records</a>, and <a href="https://github.com/phodal/pero/blob/master/ROADMAP.md">roadmap</a>.</dd>
          </dl>`,
      },
    ],
  },
};
