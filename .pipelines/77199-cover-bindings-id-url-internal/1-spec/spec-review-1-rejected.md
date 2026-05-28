# Spec Review

## Verdict: rejected

## Summary

The spec is well-organized, traces back to the prompt and requirements thoroughly, and gives the design phase a strong scaffold. Glossary, Out-of-Scope, and Given-When-Then ACs are all in good shape. However the spec has several internal contradictions and HOW-bleed that would let two implementers build different things, plus one AC that asserts a behaviour the spec explicitly says is unresolved. These are real defects, not stylistic preference — they need a focused rewrite pass before the spec is implementable. Most issues are major; a couple are minor and could be addressed in the design phase if the major ones get fixed.

## Issues

### Issue 1: AC-14 asserts behaviour the spec says is unresolved (OQ-1) [blocker]

**What's wrong:** AC-14 reads "Given a Cover block bound to `core/pattern-overrides`, when the user inspects the block toolbar, then the media-replace control is present (Pattern Overrides allows edits) — pending OQ-1 resolution." An acceptance criterion cannot simultaneously assert an observable outcome AND defer the outcome to a later phase. Either the media-replace control is present under Pattern Overrides (and AC-14 is testable now) or the outcome is unresolved (and AC-14 should not exist yet, or should be reworded as a conditional contract on the OQ-1 resolution).

The same issue partially affects Req 7 ("MUST be hidden when ... `canUserEditValue` returns false") which presumes a particular OQ-1 resolution (hide for non-editable sources, show for editable) without making the prompt's blanket "Hide the media-replace control" reconcile explicitly. The reader is left wondering whether the prompt's wording is authoritative or whether the spec is overriding it.

**Where in spec:** Acceptance Criteria → Control hiding → AC-14; Requirements → B.7.

**Suggestion:** Resolve OQ-1 inside the spec (this is a WHAT decision, not HOW), then state the rule unambiguously. Recommended resolution per the requirements doc's analysis (Q7): when `canUserEditValue` returns true (Pattern Overrides), media-replace stays visible and writes through to the binding; when it returns false (post-meta etc.), it hides. Lock this in Req 7 and AC-13/AC-14, drop the "pending OQ-1" language, and remove OQ-1 from the open-questions list. Alternatively: pick the prompt's literal reading ("always hide media-replace when bound") and adjust AC-14 to assert absence under Pattern Overrides too. Either is fine; just pick one in the spec.

**Why it matters:** As written, the spec is not implementable — two implementers reading AC-14 would build different UIs, and the e2e test (AC-25) cannot be written until OQ-1 is decided. Open questions belong to genuine design-phase HOW choices, not to ambiguities in user-observable behaviour.

### Issue 2: AC-23 + Req 25 vs AC-19 — embed-video interaction with saved-parallax markup is contradictory [major]

**What's wrong:** AC-19 unconditionally requires that "Given a Cover with `hasParallax: true` and `isRepeated: true` saved in markup, and a binding subsequently activated on `url`, when the server renders the cover, then the output contains an `<img>` (not a `<div style="background-image">`)". But Req 25 says "the binding-aware derivations (effective dim ratio, overlay color) SHOULD short-circuit when `backgroundType === "embed-video"`", and AC-23 says embed-video bindings allow the panel to expose `url` but the binding-aware derivations short-circuit.

Two questions are left unanswered:
1. If a Cover has `backgroundType: "embed-video"` AND `hasParallax: true` is somehow set (today these are mutually exclusive in the UI, but `backgroundType` is set at media-select time and could in principle co-exist with a stale `hasParallax`), what does the server do under AC-19? Does the embed-video render path win or the parallax→`<img>` rewrite?
2. If a Cover has `backgroundType: "embed-video"` AND a binding resolves a URL, does the server render an embed iframe (existing flow) or an `<img>` (per AC-19)? The Out-of-Scope says "Embed-video × bindings interaction" is excluded from this PR beyond non-regression, but AC-19 doesn't carve embed-video out.

**Where in spec:** Acceptance Criteria → Render-time effective values → AC-19; Out of Scope → Embed-video; Cross-cutting invariants → Req 25; Acceptance Criteria → Non-regression → AC-23.

**Suggestion:** Add an explicit precondition to AC-19: "Given `backgroundType !== "embed-video"` AND a Cover with `hasParallax: true` and `isRepeated: true` saved in markup, AND a binding subsequently activated on `url`, ...". Or assert explicitly in Req 25 / Out-of-Scope that when `backgroundType === "embed-video"`, the binding-resolution server path does not engage (the existing oEmbed render runs unchanged regardless of binding presence). Either is fine; the spec just needs to state which one is in effect so the test author and the implementer agree.

**Why it matters:** Without this, the server-render PR can ship in two different shapes (intercept all bound covers vs intercept only `backgroundType === "image"` covers) and pass different versions of the e2e test. Reviewer @ockham gates this area and is likely to flag inconsistency.

### Issue 3: AC-16 contradicts itself on the dim-ratio class value (HOW bleed) [major]

**What's wrong:** Req 14 says the effective dim ratio is "non-opaque (target: 50)" — i.e. 50 is a target, not a contract. AC-15 says "the displayed overlay is NOT fully opaque (effective dim ratio 50 applied)" — parenthetical-50 is informative. But AC-16 says "the overlay span class is `has-background-dim-50` (or equivalent non-opaque), NOT `has-background-dim-100`". The "or equivalent non-opaque" hedge plus the literal class `has-background-dim-50` is contradictory: a literal class IS the only equivalent under the existing `dimRatioToClass` mapping (`shared.js:32-36`).

If the spec wants the class to be exactly `has-background-dim-50`, say so without the hedge. If the spec wants any non-opaque value, drop the literal class and assert only that the class is not `has-background-dim-100`. As written, an implementer who derives effective dim ratio of 40 (producing `has-background-dim-40`) would pass the "equivalent non-opaque" reading but fail the literal-class reading.

This is also HOW-bleed: picking 50 specifically is an implementation choice (the prompt only says "must not result in a fully opaque overlay"). The user-observable requirement is "overlay is not fully opaque." The exact effective value belongs in the design doc.

**Where in spec:** Requirements → D.14; Acceptance Criteria → AC-15; AC-16.

**Suggestion:** Two acceptable resolutions:
- (a) Lock the value: state in Req 14 that the effective ratio is 50 (matching the existing `onSelectMedia` downshift); drop "target: 50" hedge and "or equivalent" in AC-16. Then AC-16 reads cleanly as `has-background-dim-50`.
- (b) Keep the value open: Req 14 says "non-opaque (the same value the existing `onSelectMedia` downshift uses)"; AC-15 asserts only "overlay is not fully opaque (computed opacity < 1.0)"; AC-16 asserts only "overlay span class is not `has-background-dim-100`". Implementer + design doc resolve the specific value.

Pick (a) or (b). The current mixed phrasing is the worst of both.

**Why it matters:** Tests written today against AC-16 will hardcode `has-background-dim-50` and will fail if the design doc picks 40 (or any other value). This costs at least one re-test cycle.

### Issue 4: Internal-media affordance (Req 16 / AC-4) is too soft to test [major]

**What's wrong:** Req 16 says "the editor MUST surface a clear `internal media required` UX — for example, a visible message in the placeholder or inspector — rather than rendering the cover with a broken image element. The chosen surface is a design decision; the visibility requirement is the constraint." AC-4 mirrors this: "the cover displays a visible `internal media required` affordance and does NOT render a broken `<img>`."

The e2e author cannot write an assertion against this. "Visible affordance" doesn't tell the test:
- What text? (`"internal media required"` literal? Translation key? Custom copy?)
- What element/role? (a `Notice` component? a placeholder text? an inspector message?)
- Visible where? (placeholder area? inspector panel? toolbar?)

The spec is allowed to defer surface choice to the design doc, but the AC then needs a testable proxy — for example, "the cover does NOT emit an `<img>` element AND the placeholder area contains text matching the i18n key `cover.binding-internal-media-required` (or a stable test-id)."

**Where in spec:** Requirements → D.16; Acceptance Criteria → Internal-media-only invariant → AC-4.

**Suggestion:** Either pin down at least the test-observable signal (a stable `data-testid` or a known i18n string) in Req 16, OR define a negative-only AC ("no `<img>` is emitted for the unresolved binding") and move the positive-affordance assertion to the design phase. If the latter, add a Risk noting that the affordance surface is undefined until design.

**Why it matters:** AC-4 is one of the four ACs that gate the internal-only invariant — the headline architectural constraint from the prompt. If it's untestable, the invariant ships unverified.

### Issue 5: OQ-5 (id/url must bind to same source?) is a WHAT question, not HOW [major]

**What's wrong:** OQ-5 asks: "Must `id` and `url` bind to the same source? Should the editor validate that `metadata.bindings.id.source === metadata.bindings.url.source`? Should it block save if they differ? Or treat any mismatch as an unresolvable binding per AC-4?"

These three outcomes are user-observable behaviours that map to different test cases. They're not "implementation detail" — they define the user contract for an edge case the prompt specifies (Internal-only invariant). The spec should pick one of the three and capture it as a requirement and an AC.

This is the same class of error as Issue 1 (AC-14): a behavioural contract is being deferred to a phase that's not supposed to make user-observable decisions.

**Where in spec:** Open Questions → OQ-5.

**Suggestion:** Resolve OQ-5 in the spec. Recommended: "treat any mismatch as an unresolvable binding per AC-4" — this matches the existing Internal-only-invariant story and avoids a save-blocking dialog that would slip scope. Add a new AC: "Given a Cover with `metadata.bindings.id.source !== metadata.bindings.url.source`, when the editor renders the cover, then the cover displays the internal-media-required affordance (per AC-4)."

**Why it matters:** Mismatched-source binding is the exact edge case that produced the external-URL scope creep in PR #74109. Leaving it open to design means the design phase has to relitigate it, and the implementer has no contract to test against.

### Issue 6: AC-18 (`useFeaturedImage: true` + binding) is in-scope but Out-of-Scope says featured-image binding is a follow-up [minor]

**What's wrong:** Out of Scope lists "Featured-image binding for Cover" as a separate follow-up PR. AC-18 specifies behaviour when both `useFeaturedImage: true` AND a binding on `url` exist simultaneously: "the bound `url` is shown, NOT the featured image URL. Server render does NOT inject a second `<img>`." Concretely this IS featured-image × binding interaction, and the AC defines a precedence rule.

This is not literally a contradiction (the in-scope work is "binding wins over featured image, do not double-render"; the out-of-scope work is "express featured-image-as-a-binding"), but the language overlap is confusing and the spec doesn't explain the distinction.

**Where in spec:** Out of Scope, fourth bullet; Acceptance Criteria → AC-18.

**Suggestion:** Either rephrase the Out-of-Scope bullet to "Using a binding source to express `useFeaturedImage` behaviour (e.g. a `featured-image-url` binding source returning the post's featured-image URL) is out of scope." Or add a one-line note in AC-18 cross-referencing the Out-of-Scope bullet ("this is the *precedence* rule; expressing featured-image as a binding source is OOS — see Out of Scope").

**Why it matters:** Minor, but reviewers (including @ockham per Risk #4) will notice this. Cheap to fix.

### Issue 7: AC-19 mechanism depends on OQ-4 mechanism, which depends on OQ-3 approach [minor]

**What's wrong:** AC-19 requires the server, when bindings are active, to emit `<img>` instead of `<div style="background-image: ...">` and to strip `has-parallax` / `is-repeated` classes from the relevant element. OQ-4 acknowledges this mechanism is undetermined ("Confirm in design that this is the chosen mechanism and that it is safe across all known cover markup variations"). OQ-3 leaves the server-side approach (A vs B) open.

The AC itself is testable (HTML output is `<img>` or not, classes are present or not), so this is not a blocker. But the spec is asserting a *server behaviour* (replace `<div>` with `<img>`) before deciding the mechanism — the design phase could plausibly decide that this rewrite is infeasible (HTML Tag Processor edge cases on user-modified Cover markup) and choose to make `hasParallax` non-overridable by binding instead. Then AC-19 becomes wrong.

**Where in spec:** Acceptance Criteria → AC-19; Open Questions → OQ-3, OQ-4.

**Suggestion:** Either resolve OQ-4 in the spec (commit to the element-replacement approach) and treat AC-19 as ground truth — OR weaken AC-19 to "the rendered output does not show a parallax effect (no `style="background-image: url()"` is emitted, no `has-parallax` class on a visible image element)" without prescribing the `<img>` shape. The first is preferable because it gives the implementer a concrete target.

**Why it matters:** Minor — the design phase will surface this anyway. But pinning it down in the spec lets the design phase focus on HOW, not WHAT.

### Issue 8: "Architecture verifiable from code review" ACs (AC-20, AC-21) are not runtime-testable [minor]

**What's wrong:** AC-20 and AC-21 are good architectural invariants but acknowledge in the section heading they are "verifiable from code review, not at runtime." This means the e2e/PHPUnit test suite cannot enforce them. They are listed alongside runtime-testable ACs without a clear distinction in how they get gated.

**Where in spec:** Acceptance Criteria → Architecture section header.

**Suggestion:** Two options:
- (a) Accept they are code-review-only and call them out explicitly as such in their headers (e.g. "AC-20 (code-review)") so the PR template / reviewer checklist can pick them up.
- (b) Make at least one of them mechanically testable. For example, AC-20 ("single observer for URL-derived state") can be partially asserted by a unit test that mounts the Cover edit component, sets a bound URL, asserts only one `useEffect` callback runs in response (e.g. via a `vi.spyOn` on a derivation helper). Probably more trouble than it's worth.

Option (a) is fine.

**Why it matters:** Minor — but if a future regression silently re-introduces event-keyed `useEffect`s and no human catches it in review, the @ockham architectural concern returns. Worth flagging.

## Recap

Reject reason: Issues 1, 2, 3, 4, and 5 are real defects in the spec that block downstream design and implementation. Issues 6, 7, 8 are minor and could be left for the design phase if the majors get fixed, but they're cheap to address in the same rewrite pass.
