# PR #3 follow-up regression repair

Baseline: `9b33ac4`, retaining local main `abf3e17`. All edits and tests are isolated in the PR repair worktree; the main working directory and remote main are unchanged.

## Fixed reviewed regressions

- Field-create intents have prepared/sending/unknown phases and backend+tasklist scope. Cancellation proven to precede IO clears its intent. Empty intents cannot lock a backend switch. Actual uncertain submissions still require authoritative reconciliation before recreation.
- Task creation has an independent, serialized receipt ledger in state.json, not only state.tasks. Begin/sending are persisted before IO; known GUIDs are saved before follow-up writes. Partial/unknown receipts survive normal scans, filtering, restart and followUp retries. Completed requests reuse their result. Explicit requestId supports follow-up idempotency. Manual binding on the original backend verifies task_get before clearing protection.
- Backend operation scopes use immutable settings and a generation fence, propagated through nested asynchronous operations. Every new CLI/API/bridge dispatch checks cancellation. A→B→A and path/account/config changes cannot continue an old write chain. Existing already-dispatched completions remain committable during disposal, preserving main's reopen/complete lifecycle drain.
- Document updates preserve document ID/URL and the existing generated link. Missing create receipts fail closed. Unknown lark updates never automatically create a second document; held receipts require explicit verified binding.
- Runtime state/settings writes are serialized per file and atomically replaced with private temporary files, avoiding truncated creation ledgers and older concurrent writes overtaking newer snapshots.
- lark action dispatch now performs ensure_select_options, supports delete_custom_field, and accepts the established delete_file token/type contract. Comment aliases, direction/cursor/max_pages, result field names and ID deduplication match the main bridge contract.
- Setup CLI path/index drafts are backend-isolated and revisioned. Authentication rendering includes account mode; hidden/disposed authorization watchers stop, visible/BFCache restoration explicitly rearms them without duplicate timers.

## Regression validation

- `npm run test:offline`: 60 JavaScript test files and six Python API suites passed. Live smoke intentionally excluded; no real Feishu task, field, comment, document or authorization was changed.
- New production-function VM/fake-adapter tests cover: both pre-dispatch persistence boundaries, actual unknown submissions, empty intents, partial creation → sync/filter → restart → retry, followUp/request reuse, failed persistence, generation A→B→A, cancellation before CLI spawn/API, repeated document updates with URL preservation, incomplete receipts, atomic-write queue/failure cleanup, protocol parity and setup draft/auth lifecycle.
- The retained reopenBridge regression caught an initial disposal issue in the new scope implementation; the code was fixed to commit confirmed in-flight completion without permitting any new IO. The original strict test now passes unchanged.
- relationsBridge now waits for the startup authorization receipt before asserting that an invalid user request issued no CLI calls; the no-CLI assertion is retained rather than filtered or relaxed.
- Existing main comment coordinator, formatter, Python bridge, tasklist schema, insight/chart, scheduler, activity/SSE and frontend regressions were run together.

## Review and limits

This code snapshot is prepared for independent post-fix review. Actual permission combinations, notification delivery and power-loss guarantees are not inferred from fake adapters. Receipt coordination is in-process with lifecycle reload draining; it is not a distributed exactly-once guarantee across independent hosts.
