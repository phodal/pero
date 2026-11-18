export default {
  agents: {
    title: 'Configure Agents and tools',
    label: 'Agents and tools',
    description: 'Connect a built-in or external Agent, confirm a plain-text reply, then add a workspace, context, and tool access for your task.',
    sections: [
      {
        id: 'built-in-agent',
        title: 'Configure the built-in Pero Agent',
        body: `
          <ol>
            <li>Open <strong>Settings → Built-in Agent</strong>. Enter the <strong>API URL</strong>, <strong>Model</strong>, and <strong>API Key</strong> provided by your service. The built-in defaults are <code>https://api.deepseek.com</code> and <code>deepseek-chat</code>. Use HTTPS for the URL, with HTTP available on loopback. Enter the model ID in the model field.</li>
            <li>Select <strong>Save</strong> and look for <strong>Saved</strong>. Desktop encrypts the key through the system credential store. Leave the key field empty to keep the saved key when editing the URL or model. To clear it, select <strong>Remove saved key</strong> and confirm.</li>
            <li>Open <strong>New chat</strong> and select <strong>Pero (DeepSeek)</strong> near the composer. The new session uses your saved configuration.</li>
          </ol>
          <p>Saved settings take precedence over development <code>DEEPSEEK_*</code> variables and <code>.env</code>. Existing sessions keep the configuration they started with. See <a href="{{install}}#from-source">launching from source</a> and the <a href="https://github.com/phodal/pero/blob/master/desktop/README.md#agents-and-conversations">Desktop configuration reference</a>.</p>`,
      },
      {
        id: 'external-agents',
        title: 'Connect an external Agent',
        body: `
          <p>Pero connects to external Agents using local ACP adapters. Open <strong>Settings → Models &amp; Agents</strong> to see which adapters are available. Each Agent has its own sign-in and model settings.</p>
          <dl>
            <dt>Codex and Claude</dt><dd>The Electron development preview bundles both ACP adapters. When running from source, <code>npm ci</code> at the repository root installs the project's adapters. Follow the session's sign-in instructions, then select a model offered by the Agent.</dd>
            <dt>GitHub Copilot, Grok, Qoder, and OpenCode</dt><dd>Install the ACP-capable local CLI and complete its provider configuration or sign-in. The registered executables are <code>copilot</code>, xAI's <code>grok-build</code> or the <code>grok</code> in its own installation directory, <code>qodercli</code>, and <code>opencode</code>. Restart Pero after installation and check the selector again.</dd>
          </dl>
          <p>If the session asks you to sign in from a terminal, finish the Agent's terminal sign-in, then return and select <strong>I have signed in · Continue</strong>. Follow the Agent's buttons for other sign-in methods. Review the original prompt and send it again yourself after authentication.</p>`,
      },
      {
        id: 'first-chat',
        title: 'Verify your first model reply',
        body: `
          <ol>
            <li>Open <strong>New chat</strong>. Use the folder button by the composer to choose an empty practice directory, then select a configured Agent. The workspace is the local execution target for that session. Once you have started the conversation, open a new chat to change the Agent or workspace.</li>
            <li>Send a short prompt that needs no tools or attachments. If asked to sign in, complete the steps above and submit the prompt again.</li>
          </ol>
          <blockquote><p>Reply with exactly PERO_SETUP_OK. Please do not call tools or read or change files.</p></blockquote>
          <p>The expected reply confirms a round trip to the model. <strong>Installed</strong> confirms adapter discovery, and ACP can connect before model sign-in. After getting a reply, try the <a href="{{paper}}#ask-agent">paper passage walkthrough</a> to check the Agent against your research task.</p>`,
      },
      {
        id: 'workspace-and-approvals',
        title: 'Review workspace and permission scope',
        body: `
          <p>Start in a dedicated folder. Use the context menu in the composer to choose files to send, then review the draft and references before submitting. The folder gives the local Agent a working location. Your message and data read through tools can reach the selected model provider.</p>
          <ul>
            <li>Permission choices follow the Agent's capabilities. With the built-in Agent's <strong>View only</strong> mode, the Agent can read the workspace. File changes and commands are rejected. <strong>Edit in workspace</strong> asks before writing and rejects commands.</li>
            <li><strong>Full access</strong> asks before file changes and commands. <strong>Auto-review</strong> allows these actions without a prompt. The built-in Agent's commands in these modes run without OS sandboxing. Available modes can differ by platform and external Agent.</li>
            <li>When <strong>Permission required</strong> appears, expand the related tool and review the action and destination. Approve once if the Agent offers that choice, or decline and revise the request. Select <strong>Stop</strong> to request an end to the active turn. Check the original service for effects that already happened.</li>
          </ul>`,
      },
      {
        id: 'mcp-connectors',
        title: 'Add MCP tools with Connectors',
        body: `
          <ol>
            <li>Open <strong>Connectors</strong> in Workbench or from the Apps catalog. Choose a trusted service, save its configuration, and complete its sign-in. If consent opens in a browser, review the account and scope. Enter credentials only in the connector's dedicated fields and keep them out of URLs, arguments, examples, and chat.</li>
            <li>Select <strong>Verify connection</strong>. A verified connection has discovered tools and released the probe connection. Review the <strong>Tools</strong> list, select the tools needed for this task, and save. Use the actual connection result to determine which tools are available to this account.</li>
            <li>Start a new conversation to use the connection. Host fixes the connector configuration and selected tools for that session. Changes to credentials or permissions invalidate the older connector snapshot. Open a new chat after saving, then verify with a read-only operation documented by the service.</li>
          </ol>
          <p>Direct per-Agent MCP configuration is saved separately and depends on adapter support. For features such as full-text paper search, the Agent needs the applicable MCP transport. The managed Connectors runtime is available on macOS and Linux and reports an unsupported platform on Windows. See the <a href="https://github.com/phodal/pero/blob/master/docs/adr/0025-connectors-app.md">Connectors design</a> and <a href="https://github.com/phodal/pero/blob/master/docs/fitness/connectors.md">platform verification</a>.</p>`,
      },
      {
        id: 'troubleshoot-agent',
        title: 'Troubleshoot sign-in, models, and tools',
        body: `
          <dl>
            <dt>The Agent is missing or disabled in the selector</dt><dd>Check that Desktop can find the CLI or adapter, restart Pero, and open the selector again.</dd>
            <dt>The built-in Agent needs an API key, or saving fails</dt><dd>Check that the URL, model ID, and key belong to the same service. If the system credential store is unavailable, unlock it, reopen Desktop, save, and try a new chat.</dd>
            <dt>The Agent connects and the model rejects the request</dt><dd>Resolve the authentication error using that Agent's sign-in flow. If the Agent offers a model selector, choose a model available to the account. Confirm the plain-text reply above before adding tools.</dd>
            <dt>A tool is unavailable or denied</dt><dd>Check the connection test, the tool selection, the session's permission mode, and the Agent's transport support. Start a fresh conversation after a configuration change. If the outcome of an external write is unclear, inspect the original service's record before deciding whether to repeat it.</dd>
          </dl>
          <p>Record the package version, Agent name, shareable error text, and steps to reproduce. See <a href="{{reference}}#verification-and-help">verification scope and issue reporting</a>.</p>`,
      },
    ],
  },
  compute: {
    title: 'Environments and remote compute',
    label: 'Environments and compute',
    description: 'Check local software, prepare an environment for an App or an experiment, and explicitly approve a built-in computation on an SSH workstation or Slurm.',
    sections: [
      {
        id: 'inspect-software',
        title: 'Check a method’s software requirements',
        body: `
          <p>Open <strong>Environments</strong> from the sidebar. If it does not appear, enable it in <strong>Apps</strong>. The Paper reproduction panel and Control Lab engine availability also open checks scoped to that method.</p>
          <ol>
            <li>Open <strong>Software checks</strong> and select a method, such as python-control for Control Lab. Run the check and review required software, observed versions, and missing packages.</li>
            <li>Record the method and check outcome. You can export a versioned observation. Opening the list reads saved entries. Starting a check inspects the software referred to by the current configuration.</li>
          </ol>
          <p>Once the software matches, prepare or select the environment and start the experiment in its own App. The software observation contains compatibility information. Experiment outputs and conclusions come from the subsequent run and review.</p>`,
      },
      {
        id: 'app-environment',
        title: 'Prepare and bind an App service environment',
        body: `
          <ol>
            <li>Open <strong>Environments → App environments → Create environment</strong>. Enter a name and choose a method, such as control system simulation for Control Lab. Review the runtime and packages, then choose <strong>Create and prepare</strong>.</li>
            <li>Wait for <strong>Prepared</strong>. If preparation fails, open <strong>Installation log</strong>, check the dependency source or local software reported in the error, and choose <strong>Retry</strong>. First-time preparation can download Python and the method's dependencies.</li>
            <li>Save work in the target App, then select <strong>Use this environment → Bind and restart</strong>. This restarts the App backend and stops its calculations. When <strong>Currently in use</strong> appears, verify the software in the target App. Control and Circuit share the Control Lab service environment.</li>
          </ol>
          <p>Create a new environment when changing the dependencies of a bound environment. To read PDFs, use the simpler <a href="{{install}}#prepare-environment">first-time Paper environment setup</a>.</p>`,
      },
      {
        id: 'locked-compute-profile',
        title: 'Select a locked computation profile',
        body: `
          <p>In supported macOS arm64 and Linux x64 builds, <strong>Environments → Compute</strong> creates a separate environment for Control Lab or PC-Gym. Choose a method, create a profile, and select <strong>Prepare environment</strong>. Once prepared, inspect the <code>uv.lock</code> and package content digests.</p>
          <p>Choose <strong>Use for this method</strong> to select the environment for new experiments. The App service continues running. Existing experiments keep their original environment. To continue an existing experiment, select its original environment. To rebuild a prepared profile in a separate location, use <strong>Rebuild from same lock</strong>.</p>
          <p>Preparation records installation and import checks. Start the computation from Control Lab or Paper and use the method's own approval and review steps. See the <a href="https://github.com/phodal/pero/blob/master/apps/environments/README.md#locked-scientific-computation">compute profile documentation</a> and <a href="https://github.com/phodal/pero/blob/master/docs/fitness/uv-scientific-production.md">platform verification</a>.</p>`,
      },
      {
        id: 'remote-connection',
        title: 'Set up an SSH or Slurm connection',
        body: `
          <p><strong>Version requirement.</strong> The submission, observation, and collection steps below describe the current source. The November 12, 2026 preview of Compute saves connection drafts, displays available receipts, and imports reports. Use a build containing remote execution to follow this walkthrough. See <a href="{{install}}#from-source">launching from source</a>.</p>
          <ol>
            <li>Confirm your authorized SSH alias, host identity, and writable work directory with the site administrator. Set up noninteractive access and a verified <code>known_hosts</code> entry in OpenSSH. The App uses system SSH configuration and its agent. The form stores non-secret connection details.</li>
            <li>In the <strong>Compute</strong> cluster settings, choose <strong>Add cluster draft</strong>. Enter a name, login host or SSH alias, and absolute remote working directory. Select <strong>SSH workstation</strong> or <strong>Slurm over SSH</strong>. For Slurm, specify a partition, add the account if your site requires it, and use a work directory shared by the login and compute nodes.</li>
            <li>Save the draft, open <strong>Remote execution</strong>, select the connection, and choose <strong>Probe connection</strong>. When <strong>Connection verified</strong> appears, review the host, platform, Python version, and Slurm cluster identity where available. The probe observes the submission host. Job receipts report allocated nodes when observed.</li>
          </ol>
          <p>The login host needs Python 3 on the noninteractive path. Slurm also needs the scheduler commands, Python 3 on the allocated nodes, and site authorization for the fixed resource request. See the <a href="https://github.com/phodal/pero/blob/master/docs/fitness/remote-compute.md#reproduction-and-operations">site requirements</a>.</p>`,
      },
      {
        id: 'first-remote-run',
        title: 'Run a quadrature example with a known result',
        body: `
          <ol>
            <li>In <strong>Remote execution</strong>, set <strong>Samples per repetition</strong> to <code>1000</code> and <strong>Repetitions</strong> to <code>1</code>. Select <strong>Prepare fixed inputs</strong>. The bundled CPU method integrates 4 / (1 + x²) over the interval from 0 to 1.</li>
            <li>Look for <strong>Prepared, awaiting approval</strong>. Under <strong>Frozen inputs and destination</strong>, review the attempt ID, remote directory, and SHA-256. For Slurm, check the account, partition, 1 CPU, 256 MiB, and 600-second limit. Preparation stages a remote attempt directory. Select <strong>Approve and submit</strong> when the destination and parameters are correct.</li>
            <li>Open the attempt under <strong>Saved executions</strong>. Use <strong>Observe original execution</strong> to see logs, any recorded exit code, and the Slurm job identity. A queued job is awaiting allocation. Observe again to check whether it has started or stopped.</li>
            <li>After the execution ends, select <strong>Collect and save evidence</strong>, then <strong>Download original</strong>. On success, the <code>estimate</code> in <code>result.json</code> is about <code>3.1415927369</code>. The absolute error against π is about <code>8.33e-8</code>, with a tolerance of <code>1e-6</code> and <code>checkPassed</code> set to <code>true</code>. The <code>scientificAcceptance</code> field remains <code>unreviewed</code>.</li>
          </ol>
          <p>Copy the <code>compute:&lt;attempt&gt;:&lt;sha256&gt;</code> reference into your research record to identify the exact bytes collected locally. Later remote changes leave those collected bytes intact. The result and receipt establish execution of this fixed method.</p>`,
      },
      {
        id: 'remote-recovery',
        title: 'Recover the original run and collect missing evidence',
        body: `
          <dl>
            <dt>Connection probe or preparation failed</dt><dd>Check the SSH alias and authorization, work directory access, and any Slurm account or partition. Probe after correcting the configuration, then prepare a new attempt if staging was incomplete.</dd>
            <dt>Submission reply was lost or the run needs reconciliation</dt><dd>Refresh saved executions and observe the original attempt. Preserve its identity and remote directory. Ask the site operator to reconcile the original job identity and submit time before starting another run.</dd>
            <dt>Cancellation requested</dt><dd>Observe the original attempt until the owner confirms stop. A submitted remote run can keep running after closing Pero. Reopen Compute and inspect that same attempt.</dd>
            <dt>Collection is incomplete</dt><dd>Keep the files and fixed references you already have. Resolve missing files or access issues, then choose <strong>Retry collecting missing evidence</strong>. Collection is limited to 1 MiB per file. Larger files remain in the remote directory.</dd>
          </dl>
          <p>The development verification covers authenticated loopback SSH and a Slurm fixture. This workflow submits the built-in CPU method. Live-site Slurm acceptance remains open. See <a href="https://github.com/phodal/pero/blob/master/docs/fitness/remote-compute.md">remote execution verification</a>.</p>`,
      },
    ],
  },
};
