# Linux Chrome Select Contrast

## Goal

Fix the main-menu map and quality selects rendering as a light popup with low-contrast gray text on Linux Chrome, without replacing native select behavior or changing macOS/mobile semantics.

## Acceptance

- The settings selects explicitly opt into a dark native control color scheme.
- Popup options have a deterministic dark background and readable light foreground where Chrome allows option styling.
- Native keyboard navigation, focus indication, arrow UI, persisted values, and menu layout remain unchanged.
- The change is CSS-only and does not affect gameplay, map selection semantics, quality settings, multiplayer, or authoritative state.
- A focused regression test, production build/budget check, and local Linux Chrome verification pass.
- An independent code reviewer reports no unresolved blocker, high, or medium findings before commit.

## Build

- Added a focused CSS contract test in `tests/unit/gameHudActions.test.ts`. It failed on the original stylesheet because the settings selects did not declare a dark native color scheme or deterministic option colors, then passed after the fix (4/4 tests).
- Updated only `.settings-grid select` and its `option` elements: the native control keeps `appearance: auto`, while the select and popup options use `color-scheme: dark`, foreground `var(--ink)`, and opaque background `#111714`. No HTML, value persistence, map/quality semantics, or gameplay code changed.
- Validation passed: full `npm run typecheck`; focused `gameHudActions` tests; standalone suite 21/21; browser, Worker dry-run, and standalone server builds; and performance budgets. Final CSS artifact is `44,643 / 45,000` bytes.
- The complete application suite passed 42/43 files and 411/412 tests. Its only failure was the existing `mapLayout.test.ts` landing-zone case exceeding the checked-in 30-second wall-clock timeout at 32.32 seconds under four concurrent 14-core self-play campaigns. The exact assertion also took 32.31 seconds when isolated at the default limit, then passed unchanged in 27.35 seconds with a command-line-only 60-second limit; no test threshold or map code was changed.
- Local Worker tests cannot start because this Debian host has glibc 2.28 while the installed `workerd` requires newer GLIBC symbols. Worker typecheck and dry-run build passed; the required Node 24 feature-branch CI remains the Worker test gate after push.
- Linux Chrome production-build verification used volume `0`. Both map and quality selects, and every option, computed to `color-scheme: dark`, foreground `rgb(229, 233, 223)`, background `rgb(17, 23, 20)`, and native `appearance: auto`. Expanded-menu screenshots were saved at `/tmp/last-line-linux-map-select.png` and `/tmp/last-line-linux-quality-select.png`; both showed readable dark popup rows with the native blue selected-row highlight. No page console errors occurred; only expected headless software-WebGL warnings were present. The page returned to `about:blank`, Chrome and preview stopped, and ports 8798/9222 were clear.

## Review

- 2026-08-04 17:53 UTC independent static review against `HEAD/main@c7a562a`, scoped to `src/styles/main.css`, `tests/unit/gameHudActions.test.ts`, and this plan.
  - Conclusion: not yet approved; unresolved findings are blocker 0, high 0, medium 1.
  - Medium — `tests/unit/gameHudActions.test.ts:29`: the option-color regex requires `color` to appear before `background` in the declaration block. Reordering those two equivalent declarations would incorrectly fail the regression test even though the required deep background and light foreground remain intact. Make the two property checks order-independent, for example by first matching the `.settings-grid select option` block and then asserting each declaration separately; builder action and re-review are required.
  - Static contract checks otherwise found the implementation aligned with the plan: `.settings-grid` occurs only around the main-menu map and quality selects; the change does not replace native appearance, event handling, focus behavior, keyboard behavior, persisted settings, gameplay, map, or multiplayer semantics; the option contrast is 14.75:1; and no budget threshold or unrelated tracked file changed.
  - Referenced the recorded red/green focused test, typecheck, application/standalone/Worker limitations, builds, budgets, and Linux Chrome evidence without repeating those commands, per reviewer rules.
- 2026-08-04 17:56 UTC Reviewer-M1 static re-review against `HEAD/main@c7a562a`, limited to the prior medium finding and the same scoped files.
  - Disposition: resolved. The test now extracts the `.settings-grid select option` declaration body first and asserts `color: var(--ink)` and `background: #111714` independently, so equivalent declaration reordering no longer causes a false failure.
  - No new findings. Final conclusion: approved with unresolved blocker 0, high 0, medium 0.
  - Accepted the recorded focused `gameHudActions` 4/4 and `typecheck:app` results without rerunning them; no broader suite was repeated.
