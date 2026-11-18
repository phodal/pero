export default {
  title: 'Read and research papers',
  label: 'Paper research',
  description: 'Import, annotate, and search a public PDF, then send a focused question to an Agent. Use the saved report to check citations, record gaps, and export evidence.',
  sections: [
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
        <p>You have now saved and reopened a local annotation. This flow needs no model account or API key. Paper stores annotations separately from the original PDF.</p>`,
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
        <figure><img src="{{assets}}openpero-paper-research-02-read.svg" alt="Diagram of the Paper reader, showing the PDF view and the highlight action for selected text" width="1600" height="463" loading="lazy"><figcaption>Reader walkthrough diagram. Control placement varies by version.</figcaption></figure>
        <p>For a scanned page, equation, or figure, choose <strong>Capture area</strong>, drag over the region, and confirm the image annotation. Choose <strong>Annotations → Add to matrix</strong> and enter a comparison field such as “Sample size” or “Metric.” The matrix page link opens the original region. Check values and units against headers, captions, and surrounding text.</p>`,
    },
    {
      id: 'find-sources',
      title: 'Find saved evidence and discover more papers',
      body: `
        <h3>Search your own library</h3>
        <p>Return to the library and submit <code>agentic proposer</code> in <strong>Search saved text</strong>. The results should include matching passages. Open a PDF result to return to its saved document and page. Expand <strong>Snapshot details</strong> for the complete passage, source link, and digest. This searches saved text and each source’s latest saved PDF locally without starting an Agent.</p>
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
        <p>Look for separate citations about candidate history and evaluation setup, plus any unresolved gaps. If the answer misses one part, narrow it to the terms used in the paper. Confirm that you may share the selected material with your provider before sending.</p>`,
    },
    {
      id: 'check-citations',
      title: 'Check citations, revise comparisons, and export',
      body: `
        <ol>
          <li>Open the reader’s clock icon, <strong>Research record</strong>, and select the question. Check for <strong>Report saved</strong>. If you have a chat response, confirm here that the report passed validation and was saved.</li>
          <li>Select a citation. A PDF citation opens the saved version used for the study and locates the passage. If <strong>Citation evidence</strong> lists multiple matches, open each one and find the occurrence that supports or qualifies the claim. Read the context and check conditions and units.</li>
          <li>When the report has an <strong>Evidence matrix</strong>, check the comparison definition, value, and citation in each cell. Use <strong>Edit cell</strong> and record a reason when making a correction. Paper preserves the original report and records human corrections separately.</li>
          <li>Use <strong>Export Markdown</strong> to share a readable report, or <strong>Export JSON</strong> to retain structured citations, input versions, and matrix revisions. <strong>Print / PDF</strong> creates a readable copy. Reopening a saved report needs no model call.</li>
        </ol>
        <figure><img src="{{assets}}openpero-paper-research-04-review.svg" alt="Diagram of the research record and citation evidence alongside the original PDF" width="1600" height="719" loading="lazy"><figcaption>Research record and citation walkthrough diagram.</figcaption></figure>
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
