# Code Plan Review

## Verdict: approved

## Summary

The iter-2 revision of `code-plan.md` cleanly resolves every finding from iter-1's rejection. The plan is faithful to the approved design, every spec AC and Req traces to at least one task, ordering keeps the tree green at every step, and granularity is tight (each task has explicit file paths, explicit changes, and observable per-task acceptance criteria). Codebase claims were verified against the source tree: `lib/load.php` lines 80-82 (collaboration.php insertion site), `packages/block-library/src/cover/edit/index.js` lines 95 (`context: { postId, postType }` destructure), 132 (existing `propsRef.current` pattern), 599 (empty-cover branch), 672 (`url && isImageBackground`), 750 (line-750 `<CoverPlaceholder>`), `packages/block-editor/src/utils/index.js` (only exports `transformStyles` + `getPxFromCssUnit`), `backport-changelog/7.1/10869.md` two-line format, `packages/element/src/react.ts:218` (`useEffectEvent` export) — all consistent with the plan. Approving.

## Iter-1 findings — resolution check

- **Issue 1 (HIGH — `replacePatternOverridesDefaultBinding` import blocker).** Resolved. Task 6 step 2 explicitly forbids importing the helper from `@wordpress/block-editor` and pins option (c): inline `__default` expansion in `use-cover-binding-state.js`, with a code snippet (Task 6 step 3) mirroring trunk's `replacePatternOverridesDefaultBinding`. A comment pointing at the canonical implementation is mandated.
- **Issue 2 (MEDIUM — nonexistent `AC-35`).** Resolved. Plan now uses `Req 35` (zero `AC-35` occurrences) in Tasks 10/11/12 acceptance bullets.
- **Issue 3 (MEDIUM — backport-changelog file shape).** Resolved. Task 13 §Changes step 1 now mandates the two-line format (wordpress-develop URL line, blank line, bulleted gutenberg URL).
- **Issue 4 (MEDIUM — `url`→`effectiveUrl` predicate swap).** Resolved. Task 8 §Changes step 2 explicitly mandates the predicate rewrite to `! bindingUnresolvable && effectiveUrl && isImageBackground`, with traceable rationale (the Pattern Overrides default-state hazard) and a matching acceptance bullet.
- **Issue 5 (LOW — DC-2 carve-out for `overlayColor`).** Resolved. Task 7 §Acceptance bullet 3 now explicitly calls out `overlayColor`/`customOverlayColor` as a deliberate source-agnostic continuation of trunk behavior, with a Design §5.2/§5.3 trace and explicit "only fresh `setAttributes` call is `{ isDark }`" qualifier.
- **Issue 6 (LOW — `context` plumbing).** Resolved. Task 7 §Changes step 2 contains the prop-boundary change snippet (`context` undestructured, `const { postId, postType } = context;` inside the body) with rationale (sources may declare `usesContext` for additional keys).
- **Issue 7 (LOW — embed-video e2e control case).** Resolved. Task 12 §Changes step 3 now includes the explicit embed-video control case under the default-state assertions with AC-21 preservation rationale and a matching acceptance bullet.
- **Issue 8 (LOW — missing Req traces).** Resolved. Plan now explicitly cites Req 9 (Task 2), Req 23 / Req 34 / Req 35 (Task 10), Req 35 (Task 11), Req 24 / Req 35 (Task 12), and includes a Coverage note in the Overview explaining Req 28's design-level invariant status.

## New-defect sweep

A fresh pass for new defects found nothing material:

- All file paths cited (`lib/load.php` insertion site, `packages/block-library/src/cover/edit/index.js` line numbers 95/599/672/750, `lib/compat/wordpress-7.1/` directory) match the trunk codebase as inspected.
- The `useEffectEvent` import path (`@wordpress/element`) is confirmed exported.
- Both halves of the new PHP file (Task 4 + Task 5) compose correctly — `gutenberg_cover_bindings_is_active` is defined in Task 3 and consumed in Tasks 4 and 5 (correct dependency order).
- Task ordering keeps the tree green: server-only work first (Tasks 1-5), then client (6-9), then tests (10-12), then PR metadata (13).
- Per-task acceptance criteria describe *what must be true* (observable behavior), not *which test files to write*.
- One minor semantic nit (PHP `gutenberg_cover_bindings_expand_bindings` in Task 3 expands ANY `__default`, while JS `expandDefaultBinding` in Task 6 only expands when `source === 'core/pattern-overrides'`) is not user-observable today because only `core/pattern-overrides` writes the `__default` shape per spec glossary, and Req 26 / AC-6 only require mismatched-source detection in explicit per-attribute bindings. Not worth a rejection on iter-2 — flagging here for the code-writer to consider hardening the PHP guard symmetrically if it becomes natural during implementation.

The plan is ready for execution.
