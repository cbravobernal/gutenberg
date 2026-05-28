# Cover block bindings — internal-only support for `id` and `url`

## Source

- Tracking issue: [WordPress/gutenberg#77199](https://github.com/WordPress/gutenberg/issues/77199) — *Block Bindings in WordPress 7.1*
- Open draft PR (architectural reference, not basis): [WordPress/gutenberg#74610](https://github.com/WordPress/gutenberg/pull/74610)
- Prior stalled PR (lessons): [WordPress/gutenberg#74109](https://github.com/WordPress/gutenberg/pull/74109)

## Background

The `core/cover` block has never shipped Block Bindings support. Two release cycles have produced draft PRs that stalled, despite Block Bindings working well for `core/image`, `core/paragraph`, and other content-bearing blocks. The current iteration issue (#77199) explicitly scopes Cover block bindings for the WordPress 7.1 cycle.

Prior attempts failed for two distinct reasons:

1. **Architectural complexity** (#74109) — reviewer @ockham rejected an event-driven approach in which multiple `useEffect` hooks reacted to specific user interactions (replace media, focus, blur). Logic for deriving overlay color, dim ratio, and visible controls was scattered across handlers, making behavior unpredictable. The reviewer asked for a single reactive observer that derives all dependent state from the bound `id`+`url` values themselves.

2. **CSS-in-HTML rewrite** (#74610) — when `hasParallax` is true, Cover emits `style="background-image: url(...)"` on the wrapper div. The WordPress HTML API cannot safely modify CSS values inside `style` attributes (there is no CSS Processor yet, and one was deferred). Bound `url` substitution therefore breaks under parallax.

3. **External image scope creep** (#74109) — the prior PR tried to also support binding `url` to an arbitrary external URL with no media-library `id`. That created cascading edge cases (overlay color derivation, alt text, featured image interactions, `isRepeated`, parallax) and ballooned the diff.

## Goal

Ship Block Bindings support for the `id` and `url` attributes of `core/cover`, scoped narrowly so it lands cleanly in one PR. The headline use case is **Pattern Overrides** for the Cover block.

## Scope — In

- Bindable attributes: `id` (number, media-library attachment id) and `url` (string, media-library file URL). Both flow through Block Bindings sources (e.g., `core/pattern-overrides`, `core/post-meta`).
- **Internal media only**: a bound `id` is required, and the bound `url` must be derivable from that `id` via the WordPress media library. External / CDN / arbitrary URLs are out of scope.
- Pattern Overrides supported end-to-end: bind in a pattern, override per-instance, reset to default. Reset must hide cleanly when the instance value already matches the default override state.
- When the binding is active:
  - Hide the parallax (`hasParallax`) toggle and force `hasParallax=false` for the rendered output.
  - Hide the repeat (`isRepeated`) toggle.
  - Hide the media-replace control (replacement happens via the binding source, not direct edit).
  - Hide the "Use featured image" toggle (`useFeaturedImage`).
- The Edit component derives `dimRatio` and overlay color reactively from the bound id+url, without mutating stored attributes. `dimRatio=100` (the default) must not result in a fully opaque overlay over a bound image — derive an effective value at render time when a binding is present.
- Server-side rendering produces the correct `<img>` / `background` markup for the resolved url and id, with parallax explicitly off.

## Scope — Out

- External / non-media-library URL binding. If a binding source returns a URL without an id, treat it as if no binding were set (or surface a clear "not supported in this PR" UX). Do not attempt to derive overlay/dim from external URLs.
- Parallax interaction with bindings. Parallax UI is disabled (hidden) whenever a binding is active; no attempt at server-side `style="background-image: url()"` rewriting.
- Featured-image binding for Cover (`useFeaturedImage` + binding). Separate follow-up PR.
- `backgroundType: "embed-video"` interaction with bindings. Embed-video Cover is out of scope.
- New global Block Bindings APIs. Reuse existing infrastructure; if a new filter such as `block_bindings_attribute_replaced_in_markup` is needed for non-sourced attributes, weigh it against a cover-specific server-render path during design.

## Architectural constraints (preempt prior reviewer feedback)

- **Single reactive observer**: one place in `packages/block-library/src/cover/edit/index.js` watches the bound `id` and `url` and derives every dependent value (effective dimRatio, overlay color, control visibility). No event-handler-keyed `useEffect` proliferation.
- **No attribute mutation on binding detection**: do not write to attributes from inside the observer. Derived values are computed at render time. Bound values are read through the existing block bindings API; the observer only triggers re-render.
- **Internal-only invariant enforced visibly**: when `url` is bound but `id` is missing (external), the UI must show that the binding cannot be honored, not silently render a broken Cover.

## Prior art to consult, NOT to base off

- Open draft PR #74610: take the architectural shape and the `block_bindings_attribute_replaced_in_markup` filter idea, but do not inherit its parallax scope.
- Stalled PR #74109: harvest e2e test scaffolding, overlay-reset logic, and lock-control patterns if useful. Do not branch off it.
- Local branches `add/cover-block-bindings-support` and `add/cover-block-bindings-support-v2` exist for reference only. Cherry-pick fragments at most.
- Prior pipeline `75022-block-bindings-into-block-fields` (already landed locally on branch `try/75022-...`) handles the Block Fields UI integration. The Cover block must work with the Block Fields UI shipped there, not the legacy Attributes panel.

## Key risks to address explicitly in design

1. **Pattern Overrides reset semantics** — historically broke. Enumerate the states: (a) default (no override), (b) overridden, (c) reset-to-default with binding active, (d) reset-hidden when value already matches default. Each must round-trip cleanly through editor save/load and server render.
2. **Default `dimRatio: 100`** — newly inserted Cover with binding active must not show opaque overlay. Solution lives in derived render-time value, not in attribute mutation.
3. **`backgroundType: "embed-video"`** — added after prior PRs were drafted. Confirm bindings UI does not appear or short-circuits when this is the active background type.
4. **Reviewer ockham gates this area** — his prior objections (architecture shape, internal-only scope, no scattered useEffects) must be preempted in the design doc itself, not discovered during review.

## Acceptance criteria

- The Block Fields / Block Bindings UI in the editor allows binding `id` and `url` of `core/cover` to any registered binding source whose schema matches.
- A Cover block with bound `id`+`url` renders correctly in the editor (preview) and on the front end (server-render), using the resolved internal media.
- Pattern Overrides on Cover round-trip cleanly: set value in pattern, override per instance, reset to default — all three states render correctly and produce the expected serialized markup.
- The parallax toggle, repeat toggle, media-replace control, and featured-image toggle are hidden when a binding is active.
- E2E test covers: (a) creating a Cover, binding its url+id to a Pattern Override source, (b) overriding the value on a pattern instance, (c) resetting the override, all with assertion of rendered output.
- Unbound Cover behavior is unchanged — no regressions on any existing Cover feature (parallax, repeat, featured image, embed-video, focal point, dim ratio, overlay color).
- PR diff is targeted (~under 500 net lines including tests). Architectural cleanliness gates scope.

## Repo target

- Carlos's fork (`cbravobernal/gutenberg`) → upstream PR to `WordPress/gutenberg`.
- Branch: `worktree-77199-cover-bindings-id-url-internal` (auto-derived from the pipeline slug).
- The PR description should link #77199 and call out explicitly which prior issues (#74109, #74610) it does and does not subsume.
