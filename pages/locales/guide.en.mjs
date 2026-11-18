export default {
  overview: {
    title: 'Pero documentation',
    label: 'Overview',
    description: 'Read papers, inspect data, run research Apps, and trace results back to their evidence in one desktop workbench. Start by importing a PDF.',
    sections: [
      {
        id: 'where-to-run',
        title: 'Choose where to start',
        body: `
          <p>Use the <strong>Electron desktop workbench</strong> with your own papers and data. Read sources, save annotations, and inspect datasets locally. Set up a model provider when you need an Agent.</p>
          <p>Try task assignment and result review in the <a href="../#distributed">interactive browser demo</a>. It uses example data and simulated roles. Use the desktop workbench to follow the research steps in this guide.</p>`,
      },
    ],
  },
  install: {
    title: 'Install and launch',
    label: 'Install and launch',
    description: 'Download the Electron development preview for your operating system, or launch a build from source.',
    sections: [
      {
        id: 'download',
        title: 'Download the desktop workbench',
        body: `
          <p>Open <a href="https://github.com/phodal/pero/releases">GitHub Releases</a> and read the notes and assets for your release. The <a href="https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261112">November 12, 2026 development preview</a> provides these Electron packages.</p>
          <ul>
            <li><strong>macOS Apple Silicon.</strong> Open <code>Pero-macos-arm64.dmg</code>, drag <code>Pero.app</code> into Applications, and open it from there.</li>
            <li><strong>Windows x64.</strong> Extract <code>Pero-windows-x64.zip</code> in full, then open <code>Pero.exe</code> from the extracted folder.</li>
            <li><strong>Linux x64.</strong> Extract <code>Pero-linux-x64.tar.gz</code> and run <code>./pero</code> in the extracted app folder. Your system needs the usual Electron desktop libraries.</li>
          </ul>
          <p>macOS packages are ad-hoc signed and unnotarized. Windows and Linux packages are unsigned. Check the archive against <code>SHA256SUMS</code> from the same release. If the operating system blocks launch, consult the release notes.</p>
          <p>The same preview offers <strong>Pero Native</strong> for Apple Silicon with a separate profile. This guide uses the Electron workbench for first use. Consult your release notes for features available in the package you downloaded.</p>`,
      },
      {
        id: 'prepare-environment',
        title: 'Prepare the App environment',
        body: `
          <ol>
            <li>Open Pero and select <strong>Papers</strong> in the sidebar. If prompted, choose <strong>Prepare environment</strong>.</li>
            <li>Wait for the environment to report ready. First-time setup may need internet access to download uv, CPython 3.12, and pinned App dependencies. If preparation fails, review the error details before retrying.</li>
            <li>Continue to <a href="{{paper}}">read and annotate your first paper</a>. Importing and reading a local PDF requires no model account or API key.</li>
          </ol>
          <p>See <a href="https://github.com/phodal/pero/blob/master/DEVELOPMENT.md#python-environments-and-advanced-overrides">Python environment settings</a> for pre-provisioned virtual environments and offline setup.</p>`,
      },
      {
        id: 'from-source',
        title: 'Launch from source',
        body: `
          <p>Follow the <a href="https://github.com/phodal/pero/blob/master/DEVELOPMENT.md#desktop-from-source">development guide</a> for Node.js, Go, Rust with the Wasm target, Electron, and the pinned GPUI Kit. Then run this command at the repository root.</p>
          <pre><code>npm run dev:paper</code></pre>
          <p>The command builds and opens Paper in a separate development profile. Use <code>npm run dev</code> to open the full workbench. Local reading and App computation require neither the separate Go control plane nor PostgreSQL.</p>`,
      },
    ],
  },
  paper: {
    title: 'Read your first paper',
    label: 'Read your first paper',
    description: 'Import a PDF and save an annotation. When you want further analysis, send a question and follow the citations back to the source.',
    sections: [
      {
        id: 'import-and-highlight',
        title: 'Import and save a highlight',
        body: `
          <p>Choose a PDF with selectable text. On first use, <a href="{{install}}#prepare-environment">prepare the App environment</a>.</p>
          <ol>
            <li>Open <strong>Papers</strong> from the sidebar and choose <strong>Add papers → PDF → Import PDF</strong>, or drop the file into the Paper window.</li>
            <li>Select a sentence and choose <strong>Highlight</strong>. Open <strong>Annotations</strong> from the PDF context menu and inspect the saved location and quotation.</li>
            <li>Return to the library and reopen the paper. Confirm the annotation still points to the right page. Paper saves annotations separately and retains the original PDF.</li>
          </ol>
          <p>This step requires no model. Text selection and search rely on the existing PDF text layer. If text is unavailable, use <strong>Capture area</strong> from the PDF context menu to save the location of a figure or table for review.</p>`,
      },
      {
        id: 'ask-agent',
        title: 'Ask an Agent about a passage',
        body: `
          <ol>
            <li>For the built-in Agent, open <strong>Settings → Built-in Agent</strong> and enter the API URL, model, and key. External Agents use their own sign-in flows. Full-text PDF research requires an Agent with HTTP MCP support. See the <a href="https://github.com/phodal/pero/blob/master/desktop/README.md#agents-and-conversations">Agent setup guide</a>.</li>
            <li>Click <strong>Ask AI</strong> in the reader, or select text and choose <strong>Discuss selection</strong>. Review the draft and any attached passage, then send. Your model provider may receive the question and selected text.</li>
          </ol>
          <blockquote><p>How do the authors describe when this method applies? Quote the source and list the limitations I should check.</p></blockquote>`,
      },
      {
        id: 'check-citations',
        title: 'Follow citations to the source',
        body: `
          <ol>
            <li>After the report is saved, click the clock icon labeled <strong>Research record</strong> in the reader toolbar and open the report.</li>
            <li>Click a citation and read the surrounding passage. When a quotation has multiple matches, choose the location relevant to the claim.</li>
            <li>Compare the claim with the source and review any open questions. Use <strong>Continue from here</strong> to draft a follow-up and send it when ready.</li>
          </ol>
          <p>A citation locates a source passage. Check whether the passage supports the claim and whether the method applies to your own work.</p>`,
      },
      {
        id: 'troubleshoot',
        title: 'Troubleshooting',
        body: `
          <ul>
            <li><strong>Agent fails to start or sign in.</strong> Check your Agent choice, credentials, and the error shown in the conversation. After signing in, review and resend the question.</li>
            <li><strong>Full-text search returns no matches.</strong> Try the paper's terminology, narrow your question, or select a known passage in the reader. An empty result describes the current search.</li>
            <li><strong>A study stops before submitting a report.</strong> Open the saved research record, review its findings and gaps, then choose <strong>Continue research</strong>.</li>
          </ul>
          <p>See the <a href="https://github.com/phodal/pero/blob/master/apps/paper-agent/README.md#pdf-reading">Paper guide</a> for more reading and retrieval options.</p>`,
      },
    ],
  },
  workflows: {
    title: 'Research workflows',
    label: 'Research workflows',
    description: 'Inspect a dataset version, recheck a published result, or organize materials in a research project. Check the linked verification records for versions and coverage.',
    sections: [
      {
        id: 'inspect-data',
        title: 'Inspect a dataset version',
        body: `
          <ol>
            <li>Save these <a href="https://raw.githubusercontent.com/phodal/pero/master/docs/examples/first-dataset.json">six synthetic records</a> as <code>first-dataset.json</code>. In <strong>Data</strong>, choose <strong>Add data</strong>, select the file, and confirm the import.</li>
            <li>Open the dataset and choose <strong>Explore data</strong>. Confirm the six records and three fields, then check the selected version and SHA-256 under provenance.</li>
            <li>Save a view to retain filters or chart settings. To append a revision, choose <strong>Add version</strong> on the existing entry. Importing the same filename from the library creates a separate dataset.</li>
          </ol>
          <p>Table inspection runs locally without a model. It supports UTF-8 CSV, TSV, JSON, and JSONL. Imports are limited to 10 MiB. See <a href="https://github.com/phodal/pero/blob/master/apps/data/README.md#inspection-and-saved-views">Data versions, provenance, and checks</a>.</p>`,
      },
      {
        id: 'recheck-a-result',
        title: 'Recheck one result from Fisher’s paper',
        body: `
          <ol>
            <li>In Paper, import the <a href="https://lgross.utk.edu/Math589Fall2020/RAFisher1936measurementsFlowerTaxa.pdf">original Fisher (1936) PDF used for the case</a>. For those exact file bytes, the toolbar offers <strong>Select Fisher Table III result</strong>.</li>
            <li>Review the original table, 100 input measurements, calculation, and comparison rule. Freeze the protocol and explicitly confirm a run. Compare the reported <strong>19.1434 cm²</strong> with the computed value, difference, and independent numerical check.</li>
            <li>Export the evidence ZIP, extract it, and run the command below in the extracted directory. The independent check uses the Python standard library and requires no network or model.</li>
          </ol>
          <pre><code>python -I -S verify.py</code></pre>
          <p>The recorded <code>REPRODUCED</code> verdict covers one value in the table. The paper-level verdict remains <code>NOT_ASSESSED</code>. See the <a href="https://github.com/phodal/pero/blob/master/docs/fitness/paper-fisher-reproduction.md#issue-77-closure-review--2026-11-11">Fisher case inputs and acceptance record</a>.</p>`,
      },
      {
        id: 'organize-a-project',
        title: 'Link material to a research project',
        body: `
          <p>Choose <strong>New research project</strong> and enter a name and research goal. You can also attach a local directory. Open <strong>Materials &amp; experiments → Link existing records</strong>, choose an enabled App, and link a saved paper, study, or experiment.</p>
          <p>The project stores links to the original records. Open a link to see the record in its App. If the record changes, review it and update the linked revision when needed. See <a href="https://github.com/phodal/pero/blob/master/docs/fitness/research-projects.md">research project behavior and verification</a>.</p>`,
      },
      {
        id: 'remote-compute',
        title: 'Prepare a remote computation',
        body: `
          <p>With an authorized SSH or Slurm environment, choose a connection in <strong>Compute</strong>, probe it, and prepare the bundled CPU midpoint quadrature method. Review the destination, frozen parameters, and requested resources before approving submission.</p>
          <p>Return to the original attempt to observe status, read logs, and collect saved artifacts. Verification covers an actual loopback SSH server and a Slurm fixture. Real Slurm sites and other scientific methods need separate acceptance. See the <a href="https://github.com/phodal/pero/blob/master/apps/compute/README.md">Compute guide</a> and <a href="https://github.com/phodal/pero/blob/master/docs/fitness/remote-compute.md">verification record</a>.</p>`,
      },
    ],
  },
  reference: {
    title: 'Concepts and reference',
    label: 'Concepts and reference',
    description: 'See where data and execution are managed, and check which versions, platforms, and conditions a verification record covers.',
    sections: [
      {
        id: 'concepts',
        title: 'Objects in the workbench',
        body: `
          <dl>
            <dt>Research project</dt><dd>Holds a research goal and links to App records, with an optional local directory.</dd>
            <dt>App</dt><dd>Provides a domain interface, methods, and data. Paper holds papers and research reports. Data holds dataset versions.</dd>
            <dt>Host and Agent session</dt><dd>The Host manages local Apps, credentials, Agent sessions, approvals, and cancellation. Review pending tool requests in the conversation.</dd>
            <dt>Control plane and Worker</dt><dd>The optional control plane coordinates shared tasks. A separate Worker handles them in its configured execution environment. The services need their own deployment and authorization.</dd>
          </dl>
          <p>See the <a href="https://github.com/phodal/pero/blob/master/docs/ARCHITECTURE.md">architecture guide</a> and <a href="https://github.com/phodal/pero/blob/master/apps/README.md">App development guide</a> for ownership and integration details.</p>`,
      },
      {
        id: 'data-and-cost',
        title: 'Data, permissions, and costs',
        body: `
          <ul>
            <li>Apps store domain data on the machine where they run. Model providers, literature services, MCP connectors, or shared task services can receive selected data when you use them.</li>
            <li>Local plugins and App backends run trusted code. Review where an App came from, the session's permissions, and the submitted content before using sensitive material.</li>
            <li>Model and remote compute providers handle billing. Consult provider records for charges. Research step and time limits constrain the workflow.</li>
          </ul>`,
      },
      {
        id: 'verification-and-help',
        title: 'Verification and support',
        body: `
          <p>The <a href="https://github.com/phodal/pero/blob/master/docs/fitness/README.md#acceptance-levels">quality gates</a> record source checks, desktop runs, external services, and packaged release results by feature. When evaluating a scientific result, check its sources, run inputs, comparison rules, and independent review. The <a href="https://github.com/phodal/pero/blob/master/ROADMAP.md">roadmap</a> covers planned team sync and shared research memory.</p>
          <p>When reporting a problem in <a href="https://github.com/phodal/pero/issues">GitHub Issues</a>, include the version or source revision, platform, Electron or Native, reproduction steps, and any shareable error details. See the <a href="https://github.com/phodal/pero/blob/master/CONTRIBUTING.md">contributor guide</a> to make a code change.</p>`,
      },
    ],
  },
};
