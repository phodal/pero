# Contributing to Pero

Thanks for your interest. This page sets out how we take contributions. For setup and verification commands, see [DEVELOPMENT.md](DEVELOPMENT.md); for repository conventions, see [AGENTS.md](AGENTS.md).

## Discuss first

- Small fixes (typos, broken links, minor doc edits) can go straight to a PR.
- Anything else: open an Issue first, agree on scope and acceptance criteria with a maintainer, then open the PR and link the Issue. A bounded item from the [Roadmap](ROADMAP.md) is a good starting point.

## One change, one PR

- Put related changes in a single PR and use small commits inside it.
- Do not split one piece of work into many scattered or stacked PRs.
- Keep at most 2–3 open PRs per contributor at a time. Wait for those to land or close before opening more.

## Verify your change

Run the checks relevant to what you changed (from [DEVELOPMENT.md](DEVELOPMENT.md#verification)):

```bash
npm run check                    # TypeScript, generated theme, locales, contracts
npm test                         # Rust tests
npm run test:contracts           # Host stdio output against the JSON Schema
npm run test:product             # Product model invariants
go -C server test -race ./...    # control plane
```

Say in the PR description what you ran and how you tested it, including a reproducible check for code changes.

## AI-assisted contributions

Using AI tools is fine. You remain responsible for the change: you must understand it, verify it yourself, and explain in the PR how you tested it. AI-assisted PRs follow the same review process as any other.

Bulk-generated PRs opened without prior discussion will be closed.

## Review and CI

- Maintainers may close PRs that do not follow these guidelines without a detailed review.
- CI for PRs from forks may need maintainer approval before it runs.
