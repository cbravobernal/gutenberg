# Code Plan Review

## Verdict: rejected

## Summary

The plan is dense, well-traced, and largely faithful to the approved design. Every spec AC (AC-1..AC-28) is mapped to at least one task, ordering keeps the tree green, granularity is right, and the headline e2e test does exercise Pattern Overrides default-override-reset plus the unresolvable-binding affordance. However, **one finding is a hard feasibility blocker**: Task 6 prescribes importing `replacePatternOverridesDefaultBinding` from `@wordpress/block-editor`, but that helper is NOT publicly exported — the import will not resolve and the new hook will not compile. A handful of smaller defects also need addressing: a nonexistent `AC-35` is referenced in three tasks, the `backport-changelog` file shape in Task 13 is wrong (it omits the wordpress-develop URL line), Task 8 does not state the `url`→`effectiveUrl` swap in the non-empty render-branch predicate, Task 7's acceptance silently drops `overlayColor`/`customOverlayColor` from the DC-2 prohibition list without flagging it as an intentional carve-out, and Task 6/7 hand-wave the `context` parameter even though `CoverEdit` destructures it into `{ postId, postType }` at the prop boundary. Fixing these — especially the import — is mechanical and well within one iteration.

## Issues

### Issue 1 (SEVERITY: HIGH — feasibility blocker): `replacePatternOverridesDefaultBinding` is not exported from `@wordpress/block-editor`

**What's wrong:** Task 6 step 2 specifies `Imports: replacePatternOverridesDefaultBinding from @wordpress/block-editor (utils/block-bindings)`. The function exists at `/Users/carlos/Developer/gutenberg/packages/block-editor/src/utils/block-bindings.js:27` but `packages/block-editor/src/utils/index.js` does NOT re-export it (only `transformStyles` and `getPxFromCssUnit`), and `packages/block-editor/src/index.js` only re-exports `./utils` (and `./private-apis`, but neither file forwards the helper). Verified: a `grep -rn "replacePatternOverridesDefaultBinding"` of the source tree shows only one in-package importer (`packages/block-editor/src/components/block-edit/edit.js`) using the relative path `../../utils/block-bindings`. The plan's import path resolves to nothing public; the file will fail to build the moment the code-writer types `import { replacePatternOverridesDefaultBinding } from '@wordpress/block-editor';`.

**Where in plan:** Task 6 (`packages/block-library/src/cover/edit/use-cover-binding-state.js`), §Changes step 2, and (indirectly) the §Acceptance bullets that assume the hook computes `bindingActive` via this helper.

**Suggestion:** Pick ONE and write it into the task explicitly:
- (a) Re-implement the `__default` expansion inline in `use-cover-binding-state.js` (3-4 lines mirroring `packages/block-editor/src/utils/block-bindings.js:27-46`); OR
- (b) Add a sibling sub-task that exports `replacePatternOverridesDefaultBinding` from `packages/block-editor/src/utils/index.js` (and runs `npm run build` if needed); OR
- (c) Route through the existing block-editor private-APIs (`lock-unlock`) — but that requires first locking the helper, which is a public-API decision that should be raised with reviewers.
The plan currently leaves this design decision to the code-writer, which is exactly what the plan-writer is supposed to resolve.

**Why it matters:** The blocker stops the very first task that depends on it (Task 6) and blocks every downstream task (7, 8, 9, 11, 12). The code-writer cannot make this call mid-task — option (b) is a cross-package public-API change and (c) is a reviewer-gated private-API decision; both belong in the plan, not in implementation.

---

### Issue 2 (SEVERITY: MEDIUM — broken traceability): Plan references nonexistent `AC-35`

**What's wrong:** Tasks 10, 11, and 12 each cite "AC-35" as the spec anchor for non-regression assertions. The spec defines acceptance criteria AC-1..AC-28 only — there is no AC-35. The spec's non-regression bullet under "Tests" is **Req 35**, not AC-35.

**Where in plan:**
- Task 10 §Acceptance: `The pre-existing test methods in render-block-cover-test.php continue to pass (AC-20, AC-35 non-regression).`
- Task 11 §Acceptance: `The pre-existing edit.js tests continue to pass (AC-35 non-regression).`
- Task 12 §Acceptance: `All existing tests in cover.spec.js continue to pass (AC-35).`

**Suggestion:** Replace all three with `Req 35` (or simply `AC-20`, since the spec uses AC-20 — "Unbound Cover behavior MUST be unchanged" — as the non-regression invariant). Either is acceptable; the goal is that the trace resolves.

**Why it matters:** A reviewer following the trace chain hits a dead end. The orchestrator's `code-plan-reviewer` workflow specifically calls for traceable tasks; an undefined anchor is a real defect.

---

### Issue 3 (SEVERITY: MEDIUM — wrong file shape): Task 13 backport-changelog entry omits the wordpress-develop URL

**What's wrong:** Task 13 step 1 says `Create backport-changelog/7.1/<core-pr-number>.md containing the single line: * https://github.com/WordPress/gutenberg/pull/<gutenberg-pr-number>`. Existing entries in `backport-changelog/7.1/` (verified by reading `backport-changelog/7.1/10869.md`) use the format:
```
https://github.com/WordPress/wordpress-develop/pull/<core-pr-number>

* https://github.com/WordPress/gutenberg/pull/<gutenberg-pr-number>
```
— two lines, the first being the wordpress-develop URL (matching the filename), then a blank line, then the bulleted gutenberg URL.

**Where in plan:** Task 13 §Changes step 1.

**Suggestion:** Update the change description and the acceptance bullet to match the established two-line shape. Concretely:
```
https://github.com/WordPress/wordpress-develop/pull/<core-pr-number>

* https://github.com/WordPress/gutenberg/pull/<gutenberg-pr-number>
```

**Why it matters:** AC-26 / Req 36 explicitly require the backport-changelog entry; if the code-writer follows the plan verbatim the format will be wrong and a reviewer will reject the PR.

---

### Issue 4 (SEVERITY: MEDIUM — granularity / hidden design decision): Task 8 does not specify the `url` → `effectiveUrl` swap in the non-empty image branch predicate

**What's wrong:** Task 8 step 2 says "In the non-empty image render branch (around `url && isImageBackground` near line 672)" and then describes the `bindingActive` force-`<img>` form using `src={ effectiveUrl }`. But the **predicate** itself (`url && isImageBackground`) is not explicitly rewritten. Design §5.4 (2) is explicit: `{ ! bindingUnresolvable && effectiveUrl && isImageBackground && ( ... ) }`. As written, the plan leaves the code-writer to decide whether to keep `url` in the predicate (in which case `bindingResolvedUrl` alone — with no stored `url` — never reaches the branch) or to swap it to `effectiveUrl`. This is a design decision hidden inside a task.

**Where in plan:** Task 8 §Changes step 2.

**Suggestion:** Make the predicate swap explicit. Rewrite step 2 to say something like: "Replace the non-empty image branch's outer predicate `{ url && isImageBackground && (...) }` with `{ ! bindingUnresolvable && effectiveUrl && isImageBackground && (...) }`. Then, inside, branch on `bindingActive ? (force-img form) : (existing img-or-div form using `url`)`." Add to acceptance: "The non-empty branch's gating predicate uses `effectiveUrl`, not the stored `url`."

**Why it matters:** With the predicate left as `url && isImageBackground`, a pattern-instance Cover whose stored `url` is empty (because Pattern Overrides reset just cleared it, or because the synced pattern was authored with no default) but whose `bindingResolvedUrl` is populated would render the empty-cover branch instead of the bound `<img>`, failing AC-7 (default state shows pattern default image). This is the headline Pattern Overrides path — it must not be left to chance.

---

### Issue 5 (SEVERITY: LOW — spec-vs-plan acceptance contradiction): Task 7 silently removes `overlayColor` / `customOverlayColor` from the DC-2 prohibition list

**What's wrong:** Spec DC-2 enumerates the prohibition list as: `dimRatio, useFeaturedImage, backgroundType, id, url, hasParallax, isRepeated, overlayColor, customOverlayColor`. Task 7 §Acceptance bullet 3 reads: "The observer body does NOT call `setAttributes` for `dimRatio`, `useFeaturedImage`, `backgroundType`, `id`, `url`, `hasParallax`, `isRepeated`, or `customOverlayColor`." — `overlayColor` is missing. Separately, Task 7 §Changes step 5(vi) explicitly calls `setOverlayColor( avg )` and includes a parenthetical explaining that this is "a continuation of trunk's existing media-resolution path". The design doc made the same source-agnostic argument and was approved with that carve-out.

The contradiction: the spec's DC-2 list contains `overlayColor`/`customOverlayColor`; the plan's per-task acceptance silently drops `overlayColor`. The plan is correct to align with the approved design's carve-out, but the acceptance bullet should explicitly call out the carve-out so reviewers and future maintainers see it.

**Where in plan:** Task 7 §Acceptance bullet 3.

**Suggestion:** Rewrite the bullet to make the carve-out load-bearing. For example: "The observer body does NOT call `setAttributes` for any of the DC-2-prohibited attributes EXCEPT `overlayColor`/`customOverlayColor`, whose mutation via `setOverlayColor( avg )` is a deliberate source-agnostic continuation of trunk behaviour per design §5.3 (this is not a fresh binding-state-triggered write — it is the same media-resolution path that fires for manual selection and `useFeaturedImage` URLs). The only `setAttributes` call inside the observer is `{ isDark }`."

**Why it matters:** As written, a future reviewer comparing spec DC-2 to plan acceptance sees a silent omission and may flag it. Making the carve-out explicit and traceable to design §5.3 closes the gap with one sentence.

---

### Issue 6 (SEVERITY: LOW — unspecified plumbing): Task 6 / Task 7 don't say how `context` is threaded into `useCoverBindingState`

**What's wrong:** Task 6 declares the hook signature `useCoverBindingState({ clientId, attributes, context })` and Task 7 step 2 calls it with the same shape. But `CoverEdit`'s prop signature (verified at `packages/block-library/src/cover/edit/index.js:87-96`) already destructures `context: { postId, postType }` — there is no `context` identifier in scope inside the component body. To pass `context` to the hook, the code-writer must either (a) un-destructure the prop and keep a reference, (b) reconstruct an object `{ postId, postType }`, or (c) add a new parameter at the prop boundary. The plan doesn't say which. Block-Bindings sources expect to receive the full `context` object as built by `EditWithGeneratedProps` (verified at `packages/block-editor/src/components/block-edit/edit.js:149-154`), which means option (b)'s ad-hoc reconstruction would be wrong — the source may need other context keys.

**Where in plan:** Task 6 §Changes step 1 (hook signature) and Task 7 §Changes step 2 (call site).

**Suggestion:** Add to Task 7's prerequisites or §Changes a concrete step: "Change `CoverEdit`'s prop destructuring from `context: { postId, postType }` to `context` (an un-destructured reference), and read `postId`/`postType` via `context.postId`/`context.postType` at the call sites that currently use them. Then pass `context` directly into `useCoverBindingState({ clientId, attributes, context })`." This makes the prop-boundary change explicit and preserves the source's expected context contract.

**Why it matters:** Without this, the code-writer either invents a partial `context` reconstruction (breaking some binding sources) or silently changes the prop destructuring without surfacing the diff in the PR description. Either way it is a hidden design decision in a "small" task.

---

### Issue 7 (SEVERITY: LOW — missed design coverage): Task 12 omits the embed-video control-case assertion called out in design §11.3

**What's wrong:** Design §11.3 explicitly lists, as part of the e2e default-state assertions: "On a SEPARATE embed-video Cover (control case), the same button IS visible with the 'Embed video from URL' MenuItem accessible (AC-21 preserved on the population where `backgroundType === 'embed-video'`)." Task 12 §Changes step 3 enumerates the default-state assertions but does not include this positive AC-21 control case.

**Where in plan:** Task 12 §Changes step 3 (Default state assertions block).

**Suggestion:** Either (a) add the embed-video control-case assertion to Task 12's default-state checklist with an explicit AC-21 trace; or (b) explicitly justify in the plan that AC-21 is covered server-side by Task 10's `test_embed_video_short_circuits` PHPUnit case and editor-side by Task 11's `bindingActive false for embed-video` Jest case, so an additional e2e step would be redundant. Either resolution is fine — silent omission is not.

**Why it matters:** The design doc was approved with this assertion in scope; dropping it without justification is a regression against an approved design decision. AC-21 ("no regression on embed-video covers") is a load-bearing carve-out and deserves the explicit positive assertion the design called for.

---

### Issue 8 (SEVERITY: LOW — coverage nit): Several Reqs are not explicitly traced

**What's wrong:** Sweeping the plan's `Traces to:` lines, the following spec Reqs are never explicitly cited: Req 9 (Pattern Overrides controls work automatically — implicitly covered by Req 2 / Task 2), Req 23 (Unbound Cover non-regression — implicitly covered by Task 10's AC-20 case), Req 24 (Pattern Overrides four-state round-trip — implicitly covered by Task 12), Req 28 (no new global APIs — a design choice with no task), Req 34 (PHPUnit case — covered by Task 10), Req 35 (existing tests continue to pass — referenced as the bogus `AC-35` per Issue 2). Most have implicit coverage but none are cited. This is a nit, not a defect, but the spec's "every requirement maps to at least one task" expectation is not literally satisfied.

**Where in plan:** Tasks 2 / 10 / 12 / 13 (their `Traces to:` lines).

**Suggestion:** Either (a) add the missing Reqs to the appropriate task `Traces to:` lines; or (b) acknowledge in the Overview that some Reqs are design-level (Req 28) or are subsumed by other cited Reqs/ACs. Lowest-effort fix: append Req 9 to Task 2, Req 23 to Task 10, Req 24 to Task 12, Req 34 to Task 10, and Req 35 to Tasks 10/11/12 (replacing the bogus AC-35 from Issue 2). Req 28 is design-only and can be omitted with a note.

**Why it matters:** Adversarial reviewers (including the next pipeline iteration) will check trace coverage; missing Reqs reduce confidence even when the substance is covered.

---

End of issues.
