# PR #3 main compatibility repair

## Integration baseline

- Original PR head: `a37c6efc8e747013ea70873b0c3f944bfaa21b9a`.
- Rebased onto local main `abf3e17` (includes the latest AI card, author mentions, settings simplification and narrow-chart fix).
- Resolved both writer conflicts using the shared durable comment coordinator. Resolved the moved configuration block by keeping the new setup layout while preserving main's controls and removing the obsolete inbox.
- Non-overlapping main changes were retained by rebase, not replaced with PR file snapshots.

## Runtime compatibility

- Default backend stays `feishu-sync`. Existing user authorization is not implicitly switched, copied or reauthorized; selecting `lark-cli` is explicit.
- lark-cli comment actions support Task v1 real author mentions through authenticated raw API and verify the resulting ID/task/reply association through Task v2. Same-account authors are not excluded. Native is an explicit opt-out; permission errors do not trigger fallback POSTs.
- Comment formatting, outbound deduplication and uncertain-send locks remain in the main coordinator. Large numeric comment IDs are protected before JSON parsing.
- Lost/malformed POST receipts, timeouts and server errors remain unknown; only structured authorization/validation or explicit client rejection establishes non-delivery.
- Task/comment/custom-field/folder pagination is bounded and complete: malformed pages, missing/repeated tokens or caps cannot become a successful empty/full snapshot. Folder lookup failure never triggers duplicate creation.
- Both backends share main's managed-tasklist lifecycle and 12-field schema, including legacy workspace type acceptance, option GUID/hidden-option preservation, strict field-type guards, stable tasklist client token, durable field-create intent and uncertainty reconciliation.
- Task creation uses the validated destination. Backend changes during a create return a persisted partial receipt instead of continuing writes with another identity/backend.
- Settings/authorization and avatar optimizations remain from PR #3. Main's comment inbox removal, AI reply card, author mention defaults and responsive insight charts remain.

## Verification

- `npm run test:offline`: all discovered JS tests and six Python API suites. This deliberately excludes the live smoke test.
- `npm run test:lark-transport`: strict comment/receipt/pagination tests, 60 native tasklist/field tests, actual lark JSON-parser regression and main-compatibility race tests.
- Existing fake-host lark integration verifies authorization, managed schema, task/document reads, native field writes, workspace/priority/ETA/relations/suspension/reopen and outbound echo exclusion.
- Main comment, managed-tasklist, scheduler, insight and client regressions retained and run together.
- `git diff --check` and JavaScript syntax checks.

## Limits

No real Feishu task, field, comment, document or authorization was modified for this repair. Actual delivery of notifications and all lark-cli account/tenant permission combinations remain live verification items. Missing Task v1 permissions fail explicitly rather than emitting an unmentioned reply. This branch is repaired for review; the remote main branch is not merged automatically.
