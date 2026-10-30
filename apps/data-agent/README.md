# Data Agent

Development preview. This App is built or installed explicitly and is not part
of the default Pero product. Backend and type checks are separate from Desktop
and real-model acceptance.

Import a JSON array of records, one JSON object, or JSON Lines (up to 16 MiB and
100,000 records). The original UTF-8 source is stored unchanged in the Host's
App data directory and identified by its SHA-256 digest. No connector or remote
model is needed to inspect data.

The field list distinguishes missing fields, explicit `null`, and mixed types.
Choose any 32 fields for a bounded page of up to 200 records. Filters and numeric
sorts use exact decimal values. Record identities refer to the original source,
even after sorting; source actions locate that record in the shared GPUI reader.

Charts and exports use the same matching records or explicit selection. Sum and
count charts show at most 50 groups, with omitted and excluded counts visible.
Numerical values whose decimal exponent is outside ±4096 remain readable and
exportable but are excluded from sum charts. Plot coordinates alone use floating
point; exported number tokens and sums retain precision. Exports contain every
field and a manifest with the source digest, query, selection and record pointers
(line numbers for JSON Lines).

Ask Agent freezes a revision of the existing App object and fills the owning
chat's draft. The user sends the prompt through the normal ACP session. App Use
exposes query, chart, complete source, and export actions; these return bounded
metadata rather than repeating the dataset. The declared import write accepts
up to 64 KiB of explicit JSON text; larger inputs use the App's file picker.

This is Pero's managed Data Agent App. It does not claim compatibility or account
access for the separate OpenAI Data plugin. A loopback/fixture Agent test does
not certify a real model, connector, or analytical conclusion.

Run `npm test` and `npm run typecheck` in this directory. Build with
`node scripts/build/apps.mjs --app data-agent` from the repository root.
