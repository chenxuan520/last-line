# Checkpoint Backpack Stack Validation

## Goal

Reject persisted match checkpoints whose backpack contains an unknown item or a stack quantity above that item's configured limit.

## Acceptance

- Shared checkpoint validation requires every backpack `itemId` to exist in `ITEMS`.
- Every backpack quantity remains a positive integer and does not exceed `ITEMS[itemId].maxStack`.
- Unit coverage rejects both unknown item IDs and `grenade.frag` stacks above the configured limit.
- Worker and standalone persistence coverage verifies that an oversized grenade stack deletes both room and checkpoint records during restoration.
- Required validation and independent review complete with no unresolved blocker, high, or medium findings.
- The implementation is pushed to PR #3 and the latest head passes CI and Codex review with no actionable findings.

## Implementation

- Reuse the authoritative `ITEMS` catalog in `MatchRuntime` checkpoint validation rather than duplicating stack limits.
- Extend existing corrupt-checkpoint tables in unit, Worker, and standalone tests.

## Build

- The original validator accepted both an unknown backpack item and `grenade.frag ×4`; the two new unit cases failed before the implementation change and passed afterward.
- Node.js 24.18.1 `npm run typecheck` passes for application, Worker/tests, and standalone projects.
- Focused Node.js 24 validation passes: `tests/unit/matchRuntime.test.ts` 30/30 and `tests/standalone/localDurableObjectRuntime.test.ts` 18/18.
- Full unit validation passes 48 files and 513 tests. Full standalone validation passes 3 files and 32 tests.
- The local Worker runtime cannot start because the host's glibc 2.28 does not satisfy the checked-in `workerd` binary's GLIBC_2.29–2.35 requirements; Worker test TypeScript compilation and the Worker test fixture pass typecheck, and the real Worker suite remains a required GitHub CI gate.
- Node.js 24 browser, Worker dry-run, server, and standalone builds pass.
- `npm run check:budgets` passes: browser entry `1,120,629 / 1,200,000`, largest non-entry `613,551 / 700,000`, all browser JavaScript `3,817,284 / 4,000,000`, chunks `252 / 270`, CSS `45,161 / 50,000`, entire dist `4,417,463 / 4,550,000`, Worker `553,651 / 615,000`, and standalone server `567,515 / 630,000`.
- `origin/main` remains `feea36a`; the branch already contains that base and requires no additional integration before this commit.

## Review

- Round 1 independent static review inspected the final diff, shared restoration contract, unit coverage, SQLite restart path, Durable Object eviction path, fixture isolation, type narrowing, and documentation.
- The reviewer reported 0 blocker, 0 high, 0 medium, and 0 low findings and explicitly approved the change for commit.
