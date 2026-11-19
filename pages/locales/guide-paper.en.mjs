export default {
  title: 'Read and research papers',
  label: 'Paper research',
  description: 'Import, annotate, and search a public PDF, then send a focused question to an Agent. Use the saved report to check citations, record gaps, and export evidence.',
  sections: [
    {
      id: 'release-environment',
      title: 'First launch in the November 12 preview',
      body: `
        <p>We followed this tutorial with the <a href="https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261112">v0.1.0-dev.20261112</a> macOS Apple Silicon Electron package. In a clean profile, <strong>Prepare environment</strong> returned to <strong>Environment not ready</strong>. The Host reported that the required <code>paper-autoresearch</code> plugin was missing from the package. Python preparation had yet to begin.</p>
        <p>For the rest of the walkthrough, we installed the plugin from the same release tag into the isolated profile using the packaged Host’s <code>plugininstall</code> action. After restarting the original app and choosing <strong>Prepare environment</strong>, dependency installation finished and the library opened automatically. The screenshots below use that release package with the recovered profile. <a href="https://github.com/phodal/pero/blob/v0.1.0-dev.20261112/apps/README.md#agent-plugins">Release-tag Host plugin installation</a> · <a href="https://github.com/phodal/pero/tree/v0.1.0-dev.20261112/apps/paper-agent/agent-plugins/paper-autoresearch">Matching plugin</a></p>
        <figure><a href="{{assets}}release-tutorials/paper-clean-prepare.webp"><img src="{{assets}}release-tutorials/paper-clean-prepare.webp" alt="Paper displays Environment not ready and a Prepare environment button" width="1440" height="948" loading="lazy"></a><figcaption>The clean profile returned to this screen after selecting Prepare environment.</figcaption></figure>`,
    },
    {
      id: 'import-and-highlight',
      title: 'Import your first paper and save a highlight',
      body: `
        <p>Open <strong>Papers</strong> in the desktop workbench. On first use, <a href="{{install}}#prepare-environment">prepare the App environment</a> if prompted. This walkthrough uses the public preprint <a href="https://arxiv.org/abs/2603.28052v1">Meta-Harness (arXiv:2603.28052v1)</a>. You can also use a PDF you have permission to access with selectable text.</p>
        <ol>
          <li>Download the <a href="https://arxiv.org/pdf/2603.28052v1">versioned example PDF</a>. In the library choose <strong>Add papers → PDF → Import PDF</strong>, or drop the file into the Paper window. Paper opens the saved PDF. Importing a byte-identical file reopens the existing record.</li>
          <li>On the first page, find the sentence containing <code>agentic proposer</code> in the abstract. Select text within that page. Enter a note if useful, such as “Which previous results can the proposer see?” Then choose <strong>Highlight</strong>.</li>
          <li>Right-click the PDF and choose <strong>Annotations</strong>. Check the quotation, page number, and note. Return to the library, reopen the paper, and choose the annotation’s page number. You should return to the saved page and region.</li>
        </ol>
        <p><strong>Expected result.</strong> Save the input as <code>Meta-Harness-v1.pdf</code> and the library shows <code>Meta-Harness-v1</code>. The reader shows <strong>1 / 26</strong>, with one annotation pointing to page 1. Reopen it and select the page link to return to the highlighted passage and saved note. This flow needs no model account or API key.</p>
        <figure><a href="{{assets}}release-tutorials/paper-04-highlight.webp"><img src="{{assets}}release-tutorials/paper-04-highlight.webp" alt="The Paper reader with a saved highlight, page link, and note on the first PDF page" width="1440" height="948" loading="lazy"></a><figcaption>Reopening the saved highlight in the release package after profile recovery. Paper by <a href="https://arxiv.org/abs/2603.28052v1">Yoonho Lee et al., Meta-Harness (arXiv:2603.28052v1)</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</figcaption></figure>`,
    },
    {
      id: 'reading-and-notes',
      title: 'Choose a reading view and organize annotations',
      body: `
        <ul>
          <li><strong>PDF</strong> gives you the original pagination, figures, and citation locations. Choose <strong>Page text</strong> from the PDF context menu to read the extracted text for the current page. Text selection depends on the file’s existing text layer.</li>
          <li><strong>Read</strong> displays imported text or prepared structured full text. For a supported arXiv source, review the fixed version and authorize its official HTML to retain sections, equations, and tables. HTML and PDF preserve their own source locations.</li>
          <li><strong>TeX</strong> builds a reading preview from an approved same-version source archive. The current compiler path requires macOS and Tectonic. The first build can need dependency downloads. The preview and the original PDF have separate identities and pagination. <a href="https://github.com/phodal/pero/blob/master/apps/paper-agent/README.md#typeset-tex-reading">TeX reading and diagnostics</a></li>
        </ul>
        <p>For a scanned page, equation, or figure, choose <strong>Capture area</strong>, drag over the region, and confirm the image annotation. Choose <strong>Annotations → Add to matrix</strong> and enter a comparison field such as “Sample size” or “Metric.” The matrix page link opens the original region. Check values and units against headers, captions, and surrounding text.</p>`,
    },
    {
      id: 'find-sources',
      title: 'Find saved evidence and discover more papers',
      body: `
        <h3>Search your own library</h3>
        <p>Return to the library and submit <code>agentic proposer</code> in <strong>Search saved text</strong>. The release returned one paper and 12 passages. The first hit pointed to references on page 14. Scroll to the <strong>PDF Page 1</strong> result with the abstract passage. Open it and check that the reader shows <strong>1 / 26</strong>. Expand <strong>Snapshot details</strong> to check the passage and file digest. This search runs locally without starting an Agent.</p>
        <figure><a href="{{assets}}release-tutorials/paper-05-search.webp"><img src="{{assets}}release-tutorials/paper-05-search.webp" alt="Local search lists a PDF Page 1 result containing the abstract" width="1440" height="948" loading="lazy"></a><figcaption>Finding the page 1 passage in the release package after profile recovery. Paper by <a href="https://arxiv.org/abs/2603.28052v1">Yoonho Lee et al., Meta-Harness (arXiv:2603.28052v1)</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</figcaption></figure>
        <h3>Find sources through public literature services</h3>
        <ol>
          <li>Use <strong>Add papers</strong> to search by title or keyword, or read a known paper ID. The selected public literature providers receive the search terms.</li>
          <li>Check the title, authors, date, and version before saving. Identify whether you are reading <strong>Full text</strong>, an <strong>Abstract</strong>, or a <strong>Third-party report</strong>. Open the appropriate original before evaluating methods, data, or metrics.</li>
          <li>Choose <strong>Discover</strong> on a saved paper and select <strong>Related papers</strong>, <strong>References</strong>, or <strong>Citing papers</strong>. If prompted to confirm the source, compare the OpenAlex candidate’s title, authors, and year. Save useful candidates and treat relationship results as leads to check.</li>
        </ol>
        <p>To inspect a public page that links papers, code, and data, use <strong>Add papers → Research URL</strong> with its HTTPS address. Save references first, then separately review and confirm any offered file downloads. <a href="https://github.com/phodal/pero/blob/master/apps/paper-agent/README.md#import-a-research-url">Research URL import and resource limits</a></p>`,
    },
    {
      id: 'ask-agent',
      title: 'Ask a question you can check against the source',
      body: `
        <ol>
          <li>Prepare a model using the <a href="{{agents}}">Agent setup guide</a>. Set the API URL, model, and key for the built-in Agent, or complete an external Agent’s sign-in flow. Full-PDF research requires an Agent with HTTP MCP support.</li>
          <li>Choose <strong>Discuss selection</strong> on an excerpt from the example, or choose <strong>Ask AI</strong> in the reader. Review the draft and attached excerpt. Remove unrelated text. Hide the conversation for full-width reading, or toggle it with <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>J</kbd>.</li>
          <li>For a question that needs material beyond the selected excerpt, open <strong>Research settings</strong>, select one to five saved PDFs, and enable <strong>Search full PDF text</strong>. Sending freezes the question and file versions. Follow progress and approval requests in the shared conversation.</li>
        </ol>
        <blockquote><p>In Meta-Harness v1, what information about earlier candidates can the proposer access? How do the authors separate search feedback from held-out evaluation? Cite the source for each part and identify anything the evidence leaves open.</p></blockquote>
        <p>Look for separate citations about candidate history and evaluation setup, plus any unresolved gaps. If the answer misses one part, narrow it to the terms used in the paper. Confirm that you may share the selected material with your provider before sending.</p>
        <p><strong>What happened in this run.</strong> The release offered <strong>6.2 Sol</strong>, which the service rejected for this Codex ChatGPT login. If this happens, choose a model your account supports from the menu beside the composer and resend. The test began reading the paper after switching to <strong>5.6 Sol</strong>.</p>`,
    },
    {
      id: 'check-citations',
      title: 'Check citations, revise comparisons, and export',
      body: `
        <ol>
          <li>Return to the Paper library, open <strong>Research results</strong> in its sidebar, and select the question. Check for <strong>Report saved</strong>. If you only see a chat reply, check here whether there is a saved report.</li>
          <li>Select a citation. A PDF citation opens the saved version used for the study and locates the passage. If <strong>Citation evidence</strong> lists multiple matches, open each one and find the occurrence that supports or qualifies the claim. Read the context and check conditions and units.</li>
          <li>When the report has an <strong>Evidence matrix</strong>, check the comparison definition, value, and citation in each cell. Use <strong>Edit cell</strong> and record a reason when making a correction. Paper preserves the original report and records human corrections separately.</li>
          <li>Use <strong>Export Markdown</strong> to share a readable report, or <strong>Export JSON</strong> to retain structured citations, input versions, and matrix revisions. <strong>Print / PDF</strong> creates a readable copy. Reopening a saved report needs no model call.</li>
        </ol>
        <p><strong>Expected result.</strong> In this run, 5.6 Sol saved a report with three sections and 13 evidence entries. The first numbered citation opened <strong>4 / 26</strong> and highlighted the methods passage on page 4. After restarting the release, we reopened that report and downloaded both Markdown and JSON. Both files preserved the title, and the JSON also contained sections, source passages, and source metadata. The app continued to show <strong>Conclusions not verified</strong>.</p>
        <figure><a href="{{assets}}release-tutorials/paper-07-report.webp"><img src="{{assets}}release-tutorials/paper-07-report.webp" alt="Research results shows a Report saved entry, the report text, and a citation to page 4" width="1440" height="948" loading="lazy"></a><figcaption>The same report reopened from Research results after restarting the release package.</figcaption></figure>
        <figure><a href="{{assets}}release-tutorials/paper-08-citation.webp"><img src="{{assets}}release-tutorials/paper-08-citation.webp" alt="The selected report citation opens PDF page 4 and highlights the methods passage" width="1440" height="948" loading="lazy"></a><figcaption>The first citation opens PDF page 4. The highlight is drawn by Pero. Paper by <a href="https://arxiv.org/abs/2603.28052v1">Yoonho Lee et al., Meta-Harness (arXiv:2603.28052v1)</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</figcaption></figure>
        <p>An exact match locates the quote in the saved source. For scientific review, judge whether the passage supports the claim, whether other evidence conflicts, and whether an independent check is needed. The <a href="{{workflows}}#recheck-a-result">Fisher worked example</a> shows independent numerical verification and evidence handoff.</p>`,
    },
    {
      id: 'continue-research',
      title: 'Resume an unfinished study or follow up',
      body: `
        <dl>
          <dt>The study ended before submitting a report</dt>
          <dd>Open its research record to check <strong>Findings</strong> and <strong>Still to check</strong>. Choose <strong>Continue research</strong> to proceed from the saved evidence and gaps. Check the original conversation for requests that are still running.</dd>
          <dt>The report is saved and you need one more piece of evidence</dt>
          <dd>Choose <strong>Continue from here</strong>, review the draft, and send it. For example, ask for the passage in the evaluation section that describes the held-out data. The new question retrieves its own source evidence and uses previous replies as conversation context.</dd>
          <dt>The question or set of papers has changed</dt>
          <dd>Prepare a new research input. Compare sources and gaps across the retained records. If you import a newer PDF, the earlier report still points to the version used in that study.</dd>
        </dl>
        <p>The example paper has been exercised in a real Agent and desktop run. The verification record also lists what the broad first question missed. <a href="https://github.com/phodal/pero/blob/master/docs/fitness/paper-harness-journey.md#real-agent-acceptance">Example verification and retrieval scope</a></p>`,
    },
    {
      id: 'research-plans',
      title: 'Plan a bounded literature investigation',
      body: `
        <p>Use <strong>Autonomous research</strong> to screen and read sources over multiple rounds around one question. It requires a configured built-in Pero Agent and an available workspace.</p>
        <ol>
          <li>Choose <strong>New plan</strong> and select one to five saved starting papers. Set the scope and screening criteria. For example, include original sources that describe evaluation conditions and track abstract-only candidates separately.</li>
          <li>Choose <strong>Sources to read</strong>. Begin with <strong>Saved sources only</strong> to bound the source set. When you need new sources, choose public PDFs or the policy that also permits fixed-version official HTML, as available in your version.</li>
          <li>Review rounds, searches, reading steps, model requests, and the time limit. Choose <strong>Save and review plan</strong>, then explicitly choose <strong>Start research</strong>. Review round reports, sources, and <strong>Open questions</strong>.</li>
          <li>Pausing lets you resume the same Run with the allowances already used. If the deadline passes, the allowance runs out, or you stop the study, review the retained evidence before starting any new plan.</li>
        </ol>
        <p>Round reports remain <strong>Needs review</strong>. Distinguish source passages actually read from discovered candidates and failed acquisitions. Workflow limits bound operations. Provider records determine model costs. <a href="https://github.com/phodal/pero/blob/master/docs/fitness/paper-autonomous-research.md#product-behavior">Autonomous research verification</a></p>`,
    },
    {
      id: 'troubleshoot',
      title: 'Troubleshoot reading and research',
      body: `
        <dl>
          <dt>Import fails or the PDF will not open</dt>
          <dd>Confirm the file is a PDF. Uploads accept up to 16 MiB and documents up to 500 pages. If the error names missing PDF dependencies, return to <a href="{{install}}#prepare-environment">environment preparation</a>, check the installation result, and reopen the paper.</dd>
          <dt>You can see the page but cannot select text</dt>
          <dd>Check for a text layer with <strong>Page text</strong>. For a scan, preserve the source location with <strong>Capture area</strong> or import a copy with a text layer. Full-text search does not automatically OCR scanned PDFs.</dd>
          <dt>A full-text question found no passages</dt>
          <dd>Confirm the PDF is saved and the target version contains source text. Try a method name, table name, or other source-language wording. You can also discuss a passage selected by hand. No matches means the search returned no matching passages for this attempt.</dd>
          <dt>A request is waiting or a report cannot be saved</dt>
          <dd>Check the shared conversation for sign-in, approval, and model errors. Then open the research record to check what was saved. If validation reports invalid citations, revisit those sources before retrying. Continue from an existing unfinished record when available.</dd>
        </dl>`,
    },
  ],
};
