export default {
  workflows: {
    title: 'Research workflows',
    label: 'Research workflows',
    description: 'Start with a dataset, a published result, or a set of trials. Check the inputs, method, and execution evidence, then save the records someone will need to review.',
    sections: [
      {
        id: 'inspect-data',
        title: 'From a dataset to a research notebook',
        body: `
          <p>Download six synthetic records, check fields and duplicates in Data, and save a view for the treatment group. Record your method, calculations, or conclusions separately in Notebook. When handing off your work, record the asset version and SHA-256 and include the original or an accessible source.</p>
          <ul><li>Follow the <a href="{{data}}#sample-walkthrough">six-record Data walkthrough</a>.</li><li>Save <a href="{{notebook}}#first-revision">your first Notebook revision</a> or <a href="{{notebook}}#attach-evidence">attach evidence someone can trace</a>.</li></ul>`,
      },
      {
        id: 'recheck-a-result',
        title: 'Recheck one number from Fisher Table III',
        body: `
          <p>This walkthrough rechecks the sepal-length within-species sum of squares of <strong>19.1434 cm²</strong> from Fisher (1936), Table III. Table I supplies 100 inputs, 50 each for setosa and versicolor. For each species, sum the squared deviations from its mean and add the two sums. The table reports 98 degrees of freedom. The sum of squares has no divisor.</p>
          <ol>
            <li>Download <a href="https://lgross.utk.edu/Math589Fall2020/RAFisher1936measurementsFlowerTaxa.pdf">the original university-hosted PDF</a> and import it into Paper. In the reader, choose <strong>Select Fisher Table III result</strong>. This opens the original cell on PDF page 4 (printed page 181). The action requires the original file’s SHA-256, so use the download without printing or resaving it.</li>
            <li>Open <strong>Review input observations</strong> and compare the inputs with Table I on PDF page 3 (printed page 180). Setosa row 32 reads <code>5.4</code> in the scan. Text recognition may return <code>6.4</code>. Keep the default absolute tolerance <code>0.00005</code>, confirm the inputs, statistic, and policy, then choose <strong>Freeze protocol</strong>.</li>
            <li>Choose <strong>Confirm and run fixed arithmetic</strong>. Open that attempt and review execution status, the single-result verdict, the independent check, and the original location. The recorded group sums are <code>6.0882</code> and <code>13.0552</code>. The independent exact total is <code>95717/5000</code>, with a difference of <code>0 cm²</code> from the published value.</li>
            <li>Choose <strong>Export standalone handoff ZIP</strong> and extract it into a fresh directory. The ZIP includes the original PDF, reviewed CSV, frozen protocol, execution records, and standalone verifier. Run the command below in that directory. The check requires only the Python standard library and works offline.</li>
          </ol>
          <pre><code>python -I -S verify.py</code></pre>
          <p>Expect exit code 0 and JSON with <code>count: 100</code>, exact numerator <code>95717</code>, denominator <code>5000</code>, single-result verdict <code>REPRODUCED</code>, and whole-paper status <code>NOT_ASSESSED</code>. If the environment differs from the frozen protocol, review the logs and restore it, or review the new environment and freeze a new protocol. A completed calculation outside tolerance calls for reviewing the inputs and policy. A rerun uses the same policy and keeps a separate attempt.</p>
          <p>See the <a href="https://github.com/phodal/pero/blob/master/docs/fitness/paper-fisher-reproduction.md">Fisher verification record</a> for source digests, observed runs, and recovery evidence.</p>`,
      },
      {
        id: 'organize-a-project',
        title: 'Organize materials around a research question',
        body: `
          <p>Write the question in a <a href="{{projects}}">research project</a> and link the relevant Paper documents, research records, or experiments. The project shows a summary and opens the record in its source App. To cite an exact input in a report, retain the paper version, Notebook revision, or trial ID as well.</p>`,
      },
      {
        id: 'control-experiment',
        title: 'From candidate search to independent trials',
        body: `
          <p><strong>Control Lab</strong> uses python-control for controller simulation and ngspice for a constrained second-order active low-pass simulation. Check the availability panel for the actual solver before starting. Install ngspice through your system and make its executable available on the desktop process’s PATH.</p>
          <ol><li>Freeze the system, inputs, metrics, search scenarios, and acceptance thresholds.</li><li>Run the bounded search. Compare the baseline and candidate traces and record why you chose a candidate.</li><li>Lock that candidate and run the final scenarios. Check results, units, constraints, and any failures. Use <strong>Export</strong> to get the experiment JSON and <a href="{{notebook}}#attach-evidence">attach a specific trial</a> to a notebook.</li></ol>
          <p>Interpret finite-window observations against the frozen criteria. Hardware performance, asymptotic stability, and formal acceptance require their own evidence. See <a href="https://github.com/phodal/pero/blob/master/apps/control-lab/README.md">Control Lab environment and verification requirements</a>.</p>`,
      },
      {
        id: 'remote-compute',
        title: 'Prepare a remote run',
        body: `
          <p>Use an authorized SSH or Slurm environment to try the built-in CPU midpoint quadrature. Review the connection, fixed parameters, and resources before submitting. Then check the status, logs, and collected artifacts for that attempt. Follow the <a href="{{compute}}">environments and remote compute guide</a>.</p>`,
      },
    ],
  },
  data: {
    title: 'Inspect, chart, and share data',
    label: 'Data',
    description: 'Inspect the full input at a specific file version, check fields and issues, chart the results, and save a view that opens the original records.',
    sections: [
      {
        id: 'sample-walkthrough',
        title: 'Follow a six-record example',
        body: `
          <p>This walkthrough was verified with the <strong>macOS Apple Silicon Electron package v0.1.0-dev.20261112</strong>. Open <strong>Data</strong> in the workbench sidebar and download <a href="{{examples}}first-dataset.json" download>first-dataset.json</a>. The synthetic sample contains <code>condition</code>, <code>replicate</code>, and <code>signal</code>. If the App displays <strong>Environment not ready</strong>, choose <strong>Prepare environment</strong> and wait for <strong>Add data</strong>. First-time preparation can need network access. The remaining steps run locally.</p>
          <ol>
            <li>Choose <strong>Add data</strong>, select the downloaded JSON, keep the type set to <strong>Dataset</strong>, and choose <strong>Import</strong>. This release opens <strong>Table</strong> after import. Expect <strong>Bytes matched</strong>, 6 records and 3 fields.</li>
            <li>In <strong>Table</strong>, change <strong>No filter</strong> to <code>condition</code> and choose <strong>Equals</strong>. Enter <code>treated</code> and choose <strong>Apply</strong>. Expect original rows 4–6 with signal values <code>1.3</code>, <code>1.4</code>, and <code>1.5</code>. <strong>Source</strong> beside row 4 opens a read-only document tab with that record selected. Select <strong>Data</strong> again to return to the filter.</li>
            <li>Enter <code>Treated only</code> in <strong>View name</strong> and choose <strong>Save view</strong>. Look for “View and checks saved against this exact version.” Under <strong>Checks</strong>, the full-input scope still contains 6 records, and missing fields, explicit nulls, empty strings, and duplicates each have count 0.</li>
          </ol>
          <p>Return to <strong>Table</strong> and choose <strong>Clear filter</strong> before plotting both groups. In <strong>Chart</strong>, choose <strong>bar</strong> and <strong>Current aggregation</strong>, set <strong>Group by</strong> to <code>condition</code> and <strong>Measure</strong> to <code>signal</code>, then set <strong>Aggregate</strong> to <strong>Sum</strong>. Expand <strong>Chart data (2)</strong>. The package displays <code>3.0</code> for <code>control</code> and <code>4.2</code> for <code>treated</code>. With <strong>Count</strong>, both values are <code>3</code>. The bar order can differ from the input order.</p>`,
      },
      {
        id: 'input-and-checks',
        title: 'Check field types and inspection scope',
        body: `
          <p>Data inspects UTF-8 CSV, TSV, JSON, and JSONL/NDJSON. Imports are limited to 10 MiB. A single inspection supports up to 100,000 records and 256 fields. The table pages results from the full inspection. If parsing fails, review the reported cause.</p>
          <ul>
            <li>CSV and TSV values start as text to preserve identifiers such as <code>001</code>. To filter or aggregate numerically, open <strong>Fields</strong> and choose <strong>Preview number → Apply type</strong> for that column. Check the examples that fail conversion. Values with currency symbols, thousands separators, or outer spaces need review. Failed values retain their original text.</li>
            <li>JSON preserves the difference between a missing field, <code>null</code>, and an empty string. Missing and conversion counts are cell counts. Duplicate counts are row counts. Opening issue rows pauses the table filter. Choose <strong>Return to analysis</strong> to restore your analysis.</li>
            <li>Units are view labels. Changing a label from <code>cm</code> to <code>mm</code> leaves the values intact. For a conversion, retain the rule and the new dataset version.</li>
          </ul>`,
      },
      {
        id: 'versions-and-exports',
        title: 'Pin a version, save a view, and export',
        body: `
          <ol>
            <li>To try versioning, make a copy named <code>first-dataset-v2.json</code> and append <code>{"condition":"treated","replicate":4,"signal":1.6}</code> as the seventh array item. Choose <strong>Add version</strong> beside the current version selector and import the copy. <strong>Table</strong> shows 7 records for v2. <strong>Add data</strong> from the library creates a separate entry, even for the same filename.</li>
            <li>Under <strong>Overview → Saved views</strong>, open <code>Treated only</code>. It restores <strong>v1 — first-dataset.json</strong> with the three original matching rows. The same view reopened after restarting the workbench. Reopening the view rechecks the original bytes.</li>
            <li><strong>Export reference</strong> next to the saved view downloads JSON containing its v1 SHA-256, the <code>condition = treated</code> filter and the full-input six-record check report. Include the original file or an accessible source with the reference. Use <strong>Export records</strong> for the current data subset and <strong>Export chart JSON</strong> for the chart.</li>
          </ol>
          <p>Reports and exports keep source locations and analysis settings. Data’s <strong>Project reference</strong> groups datasets. The underlying files or services govern access. See <a href="{{projects}}">research projects</a> for a separate materials index.</p>`,
      },
      {
        id: 'troubleshoot-data',
        title: 'Recover from file and inspection issues',
        body: `
          <ul><li><strong>The chart shows only treated.</strong> The chart uses matching or explicitly selected records. With the sample filter still on, the package showed a single group. Return to <strong>Table</strong>, choose <strong>Clear filter</strong> and check that 6 rows are visible with none selected.</li><li><strong>Missing or Changed.</strong> The catalog record remains. Restore the original bytes matching the admitted digest, or add a new version and save a new view.</li><li><strong>Unexpected numeric filter results.</strong> Check the field interpretation, conversion failures, and filter scope. Exact numbers and original text are recorded separately.</li><li><strong>A model file has no table.</strong> Data records its source and versions. Loading weights and running inference require a suitable method and execution environment.</li><li><strong>Archiving did not free space.</strong> Archiving moves an entry to <strong>Archived</strong> and keeps its versions and views available to restore.</li></ul>
          <p>See the <a href="https://github.com/phodal/pero/blob/master/apps/data/README.md#inspection-and-saved-views">Data inspection rules</a> and the <a href="https://github.com/phodal/pero/blob/master/docs/fitness/data-workspace.md">workbench verification record</a>.</p>`,
      },
    ],
  },
  notebook: {
    title: 'Record methods and reviewable evidence',
    label: 'Notebook',
    description: 'Save text, formulas, and evidence references in a Notebook revision. Try a small calculation, then attach a paper citation or experiment record beside a finding.',
    sections: [
      {
        id: 'first-revision',
        title: 'Create your first notebook revision',
        body: `
          <p>The steps below were verified in a fresh profile of the <a href="https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261112">November 12, 2026 Electron preview</a> on Apple Silicon macOS.</p>
          <ol>
            <li>Open <strong>Notebook</strong> in the workbench sidebar. It is already installed and enabled in this preview. If you see <strong>Environment not ready</strong>, select <strong>Prepare environment</strong> and wait for the <strong>New notebook</strong> button. The first launch may download Python and dependencies. If preparation stalls or fails, open <strong>Installation log</strong> before retrying.</li>
            <li>Choose <strong>New notebook</strong>, name it <code>Spreadsheet and revision practice</code>, and write down the input 2 and multiplier 6. The newly created notebook starts at <strong>Revision 1</strong>.</li>
            <li>Choose <strong>Insert → Spreadsheet</strong>. Type <code>2</code> in <code>A1</code> and <code>=A1*6</code> in <code>B1</code>. Select another cell to commit the formula. Once you leave <code>B1</code>, it should display the evaluated value <code>12</code>.</li>
            <li>Choose <strong>Save revision</strong>. The toolbar should report <strong>Revision 2</strong>. Change <code>A1</code> to <code>3</code>, leave the cell, and save again. Check for <strong>Revision 3</strong> and <code>B1 = 18</code>.</li>
          </ol>
          <p>Open <strong>File → Revision history → Revision 2</strong>. The read-only view should show <code>A1 = 2</code> and <code>B1 = 12</code>. The sidebar still shows the current saved revision. Choose <strong>Return to current notebook</strong> to get back to Revision 3. Use <strong>Restore as draft</strong> only when you want to edit from the old content.</p>
          <p>To check persistence, close Pero, reopen Notebook, and select the saved entry. The release test reopened Revision 3 with <code>A1 = 3</code> and <code>B1 = 18</code>.</p>
          <p>If saving conflicts with another edit, choose <strong>Export draft</strong> to preserve your changes before reviewing the latest revision. Loading the latest revision discards the current draft.</p>`,
      },
      {
        id: 'attach-evidence',
        title: 'Put the finding beside its source',
        body: `
          <ol>
            <li>Write a specific finding and identify its metric, data scope, units, and uncertainty.</li>
            <li>Insert an <strong>Evidence</strong> block. Paste a saved Paper citation or passage link, or import a Paper report JSON, choose the citation, and attach its snapshot. Expect an excerpt with the report or location identity.</li>
            <li>For an experiment, export evidence JSON from Control Lab. Insert an <strong>Experiment reference</strong> in Notebook, load the JSON, choose the specific trial, and attach a snapshot. Open the original App to inspect that attempt’s inputs, result, and checks.</li>
            <li>Save the revision. Review the notebook revision, source version, and original evidence together. If the source App adds results, earlier Notebook revisions still show the snapshots they saved.</li>
          </ol>
          <p>Notebook stores the version and evidence you selected. The source App holds the computation, source updates, and verification. Use the <a href="{{paper}}#check-citations">citation review workflow</a> to check key claims.</p>`,
      },
      {
        id: 'export-and-share',
        title: 'Choose the right export format',
        body: `
          <ul>
            <li>For the complete document, choose <strong>File → Export current JSON</strong>. In the release test, <code>Notebook.json</code> contained the practice title and raw cell formula <code>=A1*6</code>. This export includes the document and stored evidence references. Open the desired saved revision before export to capture that snapshot. Exporting the current notebook can include unsaved edits.</li>
            <li>Use <strong>File → Export workbook</strong> for worksheet names, values, and formulas. The released App produced <code>Notebook.xlsx</code> with <code>A1 = 3</code> and the <code>A1*6</code> formula in <code>B1</code>. The workbook is marked for recalculation on open. Use the JSON format when you need Notebook evidence, or Markdown for the text.</li>
            <li>For Agent review, save a revision and choose <strong>File → Ask Agent</strong>. In the release test, the composer opened a draft referencing the saved Revision 3. Inspect the reference and text before you send, then review any reply against that revision and the source evidence.</li>
          </ul>
          <p>To check the JSON export, open the <strong>…</strong> beside <strong>New notebook</strong> and choose <strong>Import notebook JSON</strong>. The practice export opened as a separate <strong>Revision 1</strong> with <code>A1 = 3</code> and <code>B1 = 18</code>. The original entry remained at Revision 3.</p>
          <p>If floating Chat covers the bottom of the <strong>File</strong> menu, use <strong>Close chat</strong> (the minus button) or <strong>Dock chat</strong> in the Chat header. Reopen <strong>File</strong> to reach <strong>Export workbook</strong>.</p>
          <p>A worksheet supports up to 200 rows and 50 columns, scalar formulas, and references across sheets in the same notebook. External workbook links, network functions, and dynamic array spilling are outside the supported subset. See the <a href="https://github.com/phodal/pero/blob/master/apps/notebook/README.md#data-and-format-boundaries">format documentation</a> and the <a href="https://github.com/phodal/pero/blob/master/docs/fitness/notebook.md">workbench verification record</a>.</p>`,
      },
      {
        id: 'publication',
        title: 'Build a manuscript from a saved revision',
        body: `
          <p>Use a current source build for the MyST publication workflow. Start with a MyST manuscript, a working Tectonic engine, and a prepared package cache. Save the revision containing the manuscript block and choose <strong>Compile saved revision to PDF</strong> from that block. Check the exact revision, log, and output in build history before previewing or downloading. The package walkthrough above exercised worksheet and JSON exports.</p>
          <p>After editing data or generating code, regenerate stale figures and update the document before you save a new revision. Failed builds retain inputs and diagnostics. The last successful PDF remains available in history. PDF compilation confirms the manuscript renders. Scientific claims require their own review. Follow the <a href="https://github.com/phodal/pero/blob/master/docs/fitness/notebook-publication.md">Fisher manuscript example with commands and expected output</a>.</p>`,
      },
    ],
  },
  projects: {
    title: 'Organize materials and conversations by project',
    label: 'Research projects',
    description: 'Keep a research goal and relevant App records together, with project conversations, approvals, and artifacts you can return to later.',
    sections: [
      {
        id: 'create-project',
        title: 'Create a research project you can resume',
        body: `
          <ol><li>Open <strong>Projects</strong> in the sidebar. Choose <strong>New research project</strong> and enter a name and goal, such as “Recheck the Fisher Table III within-species sum of squares and document each input.”</li><li>Enter an absolute local directory path if you plan to use project files, workspace tasks, or delegated file inspection. Leave it empty when organizing App materials alone.</li><li>Choose <strong>Save project</strong>. Reopen the project and confirm the goal and materials area are available. Use <strong>Edit goal</strong> to update the research question later.</li></ol>`,
      },
      {
        id: 'link-materials',
        title: 'Link materials and reopen the source',
        body: `
          <ol><li>Save a paper or research record in <a href="{{paper}}">Paper</a>, or save an experiment in Control Lab or Lab.</li><li>In the project’s right-hand <strong>Overview</strong>, choose <strong>Materials &amp; experiments → Link existing records</strong>. Select the enabled source App and the record. You can also enter Materials from <strong>Project views</strong>.</li><li>Open the link and confirm it leads to the source App. If the original record changed, inspect that version before choosing <strong>Update linked revision</strong>. If it is unavailable, the project retains the reference so you can restore the source or choose <strong>Unlink</strong>.</li></ol>
          <p>The project stores the association and observed revision. Updating or unlinking affects only the project record. For a handoff, retain the source App’s version, content digest, or trial archive as well.</p>`,
      },
      {
        id: 'project-agent',
        title: 'Give Project Agent a bounded task',
        body: `
          <p>Project Agent is available in the current source build. The November 12, 2026 preview predates it. Prepare a working <a href="{{agents}}">Agent and tools</a> and a local directory, then open a saved research project. Choose <strong>Start project conversation</strong> and submit a small, checkable task in the central Main Agent conversation.</p>
          <blockquote><p>Delegate a read-only check of the input files for the within-species sum of squares in this project directory. List each path and SHA-256, preserve the original files, and list anything you could not check.</p></blockquote>
          <ol><li>If the Main Agent creates a child conversation, open it from the sidebar and review its task and approval card. Decide whether to allow the specific command.</li><li>Expand the tool entry in the child conversation. Inspect the command, exit code, and output, and check that it read only the intended materials. Delegated work in a Git project has its own worktree. Review any changes before integrating them.</li><li>Choose <strong>Summarize with evidence</strong> from the Project Agent controls. Read the evidence, gaps, and original conversations from the Main Agent conversation. Use the message action to save a useful reply as an artifact, then reopen it from the project’s Artifacts view.</li></ol>
          <p>After refresh or restart, use the project to reopen the original conversations, history, and saved artifacts. Decide how to continue unfinished instructions after checking their state. If conversation loading fails, refresh first and keep the original session. Development workbench verification used a scripted model with actual local execution. Review real-model output and scientific acceptance separately.</p>
          <p>See the <a href="https://github.com/phodal/pero/blob/master/docs/fitness/research-projects.md#merge-review-verification--2026-11-14">Project Agent interaction and restart verification</a>.</p>`,
      },
    ],
  },
};
