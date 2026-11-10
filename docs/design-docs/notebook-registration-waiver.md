# Local registration validation waiver

The existing structured-table/catalog owner supports one explicit exception,
`required-missing-v1`: an absent required cell may be recorded as typed missing.
Invalid supplied values, options, units, schema definitions and identities still
fail normal validation. No generic bypass or external approval is implied.

The user reviews the exact missing-cell list and supplies a reason and local,
self-declared attribution. Neither is an authenticated identity or electronic
signature. The waiver binds the canonical table SHA-256, policy and complete
issue list. Editing the table clears the UI approval. A receipt must match the
submitted waiver before entering the document; stale drafts remain unchanged.

Registration uses the existing SQLite transaction and immutable record versions.
The submission identity binds both the raw table and waiver; replay returns its
original receipt, while changed reasons or attribution conflict. Receipts and
records carry the audit data in existing JSON storage, so no migration or second
owner is needed. Receipt history and catalog results show the waiver. Document
export/import retains this evidence as a snapshot, never proof of current-catalog
verification. Existing unwaived payloads and receipts remain valid.

Coverage: pure TypeScript and Python policy/receipt tests, real SQLite replay and
reopen tests, and the table-workflow browser scenario's explicit approval,
stale-form reset, registration, saved receipt, catalog and import checks.
