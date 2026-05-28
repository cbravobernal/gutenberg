# Spec Review

## Verdict: approved

## Summary

The iter-3 revision resolves all three iter-2 findings cleanly and introduces no new defects.

**Iter-2 Issue 1 (blocker — Glossary "active binding" incompatible with Pattern Overrides).** Resolved by adding a dedicated "Expanded bindings" Glossary entry that defines `__default` expansion semantics, and by rewriting the "Active binding" definition to operate *after* expansion. The spec now states explicitly: "The `__default: { source: 'core/pattern-overrides' }` shape therefore qualifies as an active binding by construction, because expansion populates `id` and `url` from the same `__default` source." The reference to the existing client helper `replacePatternOverridesDefaultBinding( bindings, supportedAttributes )` in `packages/block-editor/src/utils/block-bindings.js` is verified — the helper exists at the cited path. Reqs 4–9, 11, 14, 18 and ACs 11–15 / 18 / 19 now correctly fire for the headline Pattern-Overrides shape. AC-6 / Req 26 are also tightened to note that `__default` cannot mismatch by construction; only explicit per-attribute bindings can.

**Iter-2 Issue 2 (minor — OQ-3 HTML Tag Processor claim).** Resolved by rewriting OQ-3 to explicitly state the API limitation ("`WP_HTML_Tag_Processor` cannot rewrite a `<div>` into an `<img>` — there is no `set_tag()` / element-type-swap operation") and to enumerate the two genuinely feasible mechanisms (`$content` fragment replacement / Processor-bookmark substitution, or synthesise the full `<img>` server-side from resolved `url`/`id`).

**Iter-2 Issue 3 (minor — AC-21 embed-video URL ambiguity).** Resolved by AC-21 now stating: "the rendered embed iframe `src` is the **saved** `url` attribute, NOT the bound `url`. No URL substitution is attempted for embed-video covers; no `<img>` is synthesised; no overlay-class or parallax-class rewrite is performed." The Out-of-Scope embed-video bullet mirrors this and adds the "embed path wins even if a Cover's saved markup contains stale `hasParallax: true` alongside `backgroundType: "embed-video"`" carve-out.

Other improvements in iter-3 worth noting: Req 11 / DC-2 now enumerate the full prohibited-mutation attribute list (`dimRatio, useFeaturedImage, backgroundType, id, url, hasParallax, isRepeated, overlayColor, customOverlayColor`), which closes a small gap from iter-2. Glossary "Bound `url` / `id`" now correctly accounts for `__default`-implied bindings. Design Constraints section now explicitly mandates the PR review checklist tick DC-1/DC-2/DC-3.

No blockers, no new defects. The remaining Open Questions (OQ-1 Approach A vs B, OQ-2 disable vs hide, OQ-3 saved-markup parallax mechanism, OQ-4 specific dim-ratio value) are all genuine HOW choices appropriate for the design phase — they do not gate any user-observable contract.

Approving for design phase.
