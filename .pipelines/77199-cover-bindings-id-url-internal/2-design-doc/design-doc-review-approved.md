# Design Doc Review

## Verdict: approved

## Summary

Iter-3 resolves every iter-2 finding cleanly and introduces no new blockers. The design is now implementation-ready: every spec AC traces to a concrete mechanism, all load-bearing code references are verified against trunk, and the previously-flagged runtime hazards (`<MediaReplaceFlow>` `onSelect=undefined` crash, wrong-store `getBlockBindingsSource` lookup, missing form-1 strip pattern, drop-zone leak at line-750, ambiguous `args` equality in the PHP helper) are each addressed with explicit code shapes and trade-off discussion. The trade-off tables in §13 (server approach, AC-18 mitigation, AC-14 gating, line-750 drop-zone) give implementers and reviewers a clear paper trail for each non-obvious choice. The single remaining tension — losing the "Embed video from URL" menu item on bound non-embed-video covers — is consciously accepted, traced to the spec's Out-of-Scope "Embed-video × bindings interaction" bullet, and confirmed not to violate AC-21 (since `bindingActive=false` on embed-video covers per §5.1 step 2 preserves the affordance on the population AC-21 protects).

## Iter-2 finding resolution check

| Iter-2 Issue | Status | Notes |
| --- | --- | --- |
| 1 (blocker) — `<MediaReplaceFlow>` `onSelect=undefined` crash | Resolved | §5.5 now conditionally renders the entire `<MediaReplaceFlow>` element via `{ ! bindingActive && ( <MediaReplaceFlow …/> ) }`. AC-14 satisfied by literal DOM absence. Embed-URL menu item trade-off explicit (§5.5, §13 AC-14 gating table, §15 risk #5). |
| 2 (major) — `getBlockBindingsSource` wrong store | Resolved | §5.1 step 3 now imports from `@wordpress/blocks` directly (`import { getBlockBindingsSource } from '@wordpress/blocks';`) with explicit code refs verified at `packages/blocks/src/api/registration.ts:903-907`. |
| 3 (minor) — `args` equality check missing in PHP helper | Resolved | §6.1 spells out `$same_source && $same_args` with `==` loose-equality rationale (associative-array element-wise compare; key-order-agnostic). Mirrors §5.1 step 2 JS check. |
| 4 (minor) — form-1 strip pattern missing | Resolved | §6.4 now defines both `$form2_pattern` (`<div>...</div>`) and `$form1_pattern` (`<img … />` with optional trailing slash) explicitly. `U` ungreedy modifier rationale documented. Word-boundary `\b...\b` anchors verified for class-name accuracy. |
| 5 (minor) — line-750 `<CoverPlaceholder>` drop zone | Resolved | §5.4 (1) and §5.5 now gate the line-750 site with `{ ! bindingActive && (<CoverPlaceholder …/>) }`. Trade-off table at §13 covers the three options (gate at call site, pass `disableDropZone`, accept). `cover-placeholder.js` source remains untouched (§2.2 invariant). |

## Coverage summary

| AC | Traced in design | Adequately addressed |
| --- | --- | --- |
| AC-1 | §8 | Yes |
| AC-2 | §5.6, §9 | Yes |
| AC-3 | §5.4, §6.5(1) | Yes |
| AC-4 | §5.4, §10, OQ-6 | Yes |
| AC-5 | §6.4 (both form patterns) | Yes |
| AC-6 | §6.4, §10 | Yes |
| AC-7..AC-10 | §5.6, §9, OQ-2 | Yes |
| AC-11..AC-12 | §5.5 | Yes |
| AC-13 | §5.5 (removed alongside `<MediaReplaceFlow>`) | Yes |
| AC-14 | §5.5 (literal DOM absence via conditional render) + §5.4 line-750 gate | Yes |
| AC-15..AC-17 | §5.2, §5.4, §6.3, OQ-4 | Yes |
| AC-18 | §6.1 Part 2, §12 | Yes (`render_block_data` mutation propagates pre-`WP_Block::__construct`) |
| AC-19 | §6.2, OQ-3 | Yes |
| AC-20 | §12 | Yes |
| AC-21 | §6.1, Risk 4 | Yes (embed-video forces `bindingActive=false`) |
| AC-22..AC-24 | §11.3 | Yes |
| AC-25 | §6.5 | Yes |
| AC-26 | §2.2, §6.1 | Yes |
| AC-27 | §12 | Yes |
| AC-28 | §12 (~533 lines, just over SHOULD budget) | Yes |

## Open Questions resolution check

| OQ | Choice | Verdict |
| --- | --- | --- |
| OQ-1 | Approach A (Cover-scoped filters) | OK — trade-off table at §13 |
| OQ-2 | Disable reset button | OK |
| OQ-3 | `preg_match` + `substr` splice mechanism (i) | OK — rejected alternatives spelled out |
| OQ-4 | dimRatio 50 (symmetric with `onSelectMedia` downshift) | OK |
| OQ-5 | Render-time force-off for parallax/repeat | OK |
| OQ-6 | i18n string primary, `data-testid` secondary | OK |

## Risks mitigation check

| Risk | Mitigation | Adequate |
| --- | --- | --- |
| 1. Ockham single-observer | §5.2 single `useEffect` on `effectiveUrl` + `useEffectEvent` + race-token ref | Yes |
| 2. Pattern Overrides reset semantics | §5.6 reuse `withPatternOverrideControls` + `ResetOverridesControl` | Yes |
| 3. `dimRatio: 100` default opacity | §5.2/§5.4 `effectiveDimRatio` + §6.3 server class strip | Yes |
| 4. Embed-video collision | §6.1 short-circuit at both ends | Yes |
| 5. HTML API can't edit CSS-in-`style` | §6.2 element-replace via `preg_match` + `substr` | Yes |

## Verification notes (for the orchestrator)

The iter-3-specific changes were verified against trunk during this review pass:

- **`getBlockBindingsSource` direct module export** — `packages/blocks/src/api/registration.ts:903-907` confirms the module-level export that internally calls `unlock( select( blocksStore ) ).getBlockBindingsSource( name )`. Matches §5.1 step 3's `import { getBlockBindingsSource } from '@wordpress/blocks';` claim.
- **`<MediaPlaceholder disableDropZone>` short-circuit** — `packages/block-editor/src/components/media-placeholder/index.js:378-381`: `renderDropZone` early-returns `null` when `disableDropZone` is truthy. Confirms §5.5's `disableDropZone` alternative is a viable approach, though the call-site gate is the simpler one-line change.
- **`<MediaReplaceFlow>` internal `onSelect` invariants** — `packages/block-editor/src/components/media-replace-flow/index.js:115` (`onSelect( media )` in `selectMedia`) and line 124 (`onSelect( files )` in `uploadFiles`). Both unconditional. Confirms iter-2 Issue 1 finding and motivates the iter-3 conditional-render fix.
- **`render_block_data` filter location** — `wp-includes/blocks.php:2398` confirms the filter fires before `new WP_Block( $parsed_block, ... )` at line 2436. Mutation propagates as designed.
- **`replacePatternOverridesDefaultBinding` shape** — `packages/block-editor/src/utils/block-bindings.js:27` confirms the helper exists and matches the signature used in §5.1 step 1.
