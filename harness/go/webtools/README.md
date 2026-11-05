# Explicit web tools

`WebSearch` and `WebFetch` use a launch-selected provider. Importing this package
does not enable them, read credentials or contact a service. Both tools use the
existing approval channel, tool hooks, owner scopes and cancellation lifecycle.

The DeepSeek implementation makes one POST per search or fetch, shares one
process-wide HTTP attempt budget, rejects provider redirects, and performs no
automatic retry. Errors exclude credentials, response bodies and endpoint values.
HTTPS is required except for loopback HTTP fixtures. Fetch targets are sent to
the provider; this host does not open arbitrary target URLs.

Search results retain source URLs and bounded excerpts. Domain filters match a
host and its subdomains, never lookalike suffixes. The output records filtered
results and truncation; a filtered provider window is not an exhaustive search
of the requested domains. Relevant URLs are rendered as Markdown citations.

Claude's `WebFetch(url, prompt, offset?)` contract includes a separate model
extraction. The provider returns Markdown, and the CLI runs extraction through
the existing subagent activation with an empty tool allowlist. Only the extracted
text returns to the parent. The parent model budget, approval policy, depth,
cancellation and real child cleanup remain in effect. Unicode character offsets
select at most 100,000 page characters; the result reports the next offset when
more content remains.

Compatibility limits: this implementation has no response cache or automatic
retry. The retrieval API does not expose the target's final redirect URL or
status, so the tool cannot reproduce Claude's cross-host redirect handoff. Its
explicitly selected search backend differs from Claude's hosted backend.

Protocol references: [Claude tool inputs](https://code.claude.com/docs/en/agent-sdk/typescript#webfetch),
[Claude web behavior](https://code.claude.com/docs/en/tools-reference#webfetch-tool-behavior),
and the [Search/Fetch API](https://api-docs.deepseek.com/guides/search/).
See `SOURCE.json` for the implementation provenance and license notice.
