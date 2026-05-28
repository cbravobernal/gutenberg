# Requirements

## Rough Idea

(Verbatim from `/Users/carlos/Developer/gutenberg/.claude/worktrees/77199-cover-bindings-id-url-internal/.pipelines/77199-cover-bindings-id-url-internal/0-prompt/prompt.md`.)

### Cover block bindings — internal-only support for `id` and `url`

The `core/cover` block has never shipped Block Bindings support. Tracking issue [#77199](https://github.com/WordPress/gutenberg/issues/77199) scopes Cover block bindings for the WP 7.1 cycle. Two prior draft PRs ([#74109](https://github.com/WordPress/gutenberg/pull/74109), [#74610](https://github.com/WordPress/gutenberg/pull/74610)) stalled over:

1. **Architecture** — reviewer @ockham rejected event-driven `useEffect` proliferation for deriving overlay color, `dimRatio`, etc.; asked for a single reactive observer keyed on the bound `id`/`url`.
2. **CSS-in-HTML rewrite** — when `hasParallax` is true, Cover emits `style="background-image: url(...)"`; the WP HTML API cannot safely modify CSS in `style` attributes.
3. **External-image scope creep** — supporting arbitrary external URLs (no `id`) ballooned the diff.

**Goal:** Ship bindings for `id` and `url` of `core/cover`, scoped narrowly, headline use-case = Pattern Overrides. **Internal media only** (`id` required, `url` derivable from `id`). When the binding is active: hide parallax / repeat / media-replace / use-featured-image controls; derive effective `dimRatio` and overlay color at render time without mutating attributes; server-side renders correct `<img>` markup with parallax off.

The full prompt (including in-/out-of-scope lists, architectural constraints, risks, acceptance criteria) lives at the path above and is treated as the authoritative source of intent for these requirements.

## Q&A

### Q1: What is the current `role` declared on `core/cover`'s `url` and `id` attributes, and what does declaring `role: "content"` change downstream?

**A:** In trunk, `core/cover`'s `url` attribute has `"role": "content"` (lines 10–13 of `block.json`); the `id` attribute does **not** declare a role (lines 18–20). The reference block `core/image` declares `"role": "content"` on **both** `url` and `id` (`packages/block-library/src/image/block.json` lines 25–31 and 78–81).

`role: "content"` is metadata used by tooling that surfaces "content-bearing" attributes (e.g. Block Fields UI, Pattern Overrides field discovery). It is **not** what enables Block Bindings UI on its own; that gating happens via the `__experimentalBlockBindingsSupportedAttributes` editor setting, which is populated from the server-side `block_bindings_supported_attributes` filter (see Q5). The current Block Bindings panel in `packages/block-editor/src/hooks/block-bindings.js` (lines 40–80) reads `bindableAttributes` from `__experimentalBlockBindingsSupportedAttributes?.[ blockName ]` and renders one `BlockBindingsAttributeControl` per supported attribute.

**Reasoning:** `role: "content"` already on `url` indicates Gutenberg considers Cover's url part of the editable content payload, but that alone has not been sufficient to enable bindings — the server-side allow-list is the gate.

**Sources:** `packages/block-library/src/cover/block.json:10-13,18-20`; `packages/block-library/src/image/block.json:25-31,78-81`; `packages/block-editor/src/hooks/block-bindings.js:40-100`; `lib/compat/wordpress-6.9/block-bindings.php:118-167`.

### Q2: For Cover bindings to appear in the editor UI, what server-side allow-list entry is required, and which file should it live in for WP 7.1?

**A:** A PHP filter must add `'id'` and `'url'` to the list returned by `gutenberg_get_block_bindings_supported_attributes( 'core/cover' )`. There are two equivalent filter hooks:
- `block_bindings_supported_attributes` (global, receives `$attributes, $block_type`)
- `block_bindings_supported_attributes_core/cover` (dynamic, block-specific)

The new code must live in a new file `lib/compat/wordpress-7.1/block-bindings.php`, registered via `require __DIR__ . '/compat/wordpress-7.1/block-bindings.php';` in `lib/load.php`. The existing 7.1 compat directory has no bindings file yet (verified via `ls lib/compat/wordpress-7.1/`).

Wrapping the filter in a `! function_exists( ... )` / version guard is the established pattern (see `lib/compat/wordpress-6.9/block-bindings.php` lines 11–31 for the prior-version precedent).

**Reasoning:** The Block Bindings panel and DataForm controls discover bindable attributes through `__experimentalBlockBindingsSupportedAttributes`, populated server-side. Without that registration, no UI for `id`/`url` will appear regardless of `role` declarations.

**Sources:** `lib/compat/wordpress-6.9/block-bindings.php:11-46,118-167`; `lib/compat/wordpress-7.1/` directory listing; the prior PR #74610 placed an equivalent filter at `lib/compat/wordpress-7.0/block-bindings.php` (now to be re-targeted to 7.1).

### Q3: How does the existing Block Bindings server-side resolution path actually substitute the bound value into the rendered HTML, and what is the gap for Cover's `url` (which has no `source`/`selector` declaration in `block.json`)?

**A:** `gutenberg_block_bindings_render_block` (in `lib/compat/wordpress-6.9/block-bindings.php:57-108`) calls `gutenberg_process_block_bindings` to resolve source values, **merges them into `$instance->attributes`**, then runs `$instance->render()` again so the block can re-render with the new attribute values. Finally it iterates the computed attributes and calls `gutenberg_replace_html` to substitute the value into the markup.

`gutenberg_replace_html` (lines 346–398) **only handles attributes that declare `source: html`, `source: rich-text`, or `source: attribute`** in `block.json`. It uses the declared `selector`/`attribute` to locate the substitution point. If `source` is unset, the function is a no-op for that attribute.

`core/cover`'s `url` has no `source` declaration (it is a plain in-memory attribute serialized via React in `save.js` — see lines 84, 117–124 of `save.js`). Therefore:
1. The `$instance->render()` re-execution can pick up the new bound `url`/`id` **if** the block's `render_callback` (`render_block_core_cover` in `packages/block-library/src/cover/index.php`) actually uses them — but today that callback only inserts an `<img>` when `useFeaturedImage` is true. For an unbound Cover with `useFeaturedImage=false`, the callback returns `$content` unmodified.
2. The static save markup (from `save.js`) is already written with the **author-time** `url` and `id`. If the binding source provides a different `url`/`id`, the saved HTML still shows the old values unless the cover render path overrides them.

The mechanism used in draft PR #74610 was to add a `block_bindings_attribute_replaced_in_markup` filter that **synthesizes** `source: attribute, selector: img, attribute: src` for `core/cover.url` at runtime, so `gutenberg_replace_html` can then rewrite `<img src="...">`. That filter does **not** handle the `<div style="background-image: url(...)">` parallax/repeat path.

**Reasoning:** Cover stores `url` as an in-memory React-managed attribute, so the existing bindings infrastructure has no metadata to know where in the markup the URL appears. Either the block must declare a synthetic source (via runtime filter), or the cover-specific server render must compute and inject the image element itself.

**Sources:** `lib/compat/wordpress-6.9/block-bindings.php:57-108,346-398`; `packages/block-library/src/cover/save.js:84,117-124`; `packages/block-library/src/cover/index.php:18-200`; PR #74610 diff (lib/compat/wordpress-7.0/block-bindings.php new file, lines around `block_bindings_attribute_replaced_in_markup`).

### Q4: When `hasParallax` or `isRepeated` is true, what does `save.js` emit, and why does HTML-attribute rewriting break?

**A:** `save.js` lines 67, 99–132 branch on `isImgElement = !(hasParallax || isRepeated)`:
- `isImgElement === true` → emits `<img className="wp-block-cover__image-background" src={url} ... />` (line 117).
- `isImgElement === false` → emits `<div role={alt ? 'img' : undefined} aria-label={alt} className={imgClasses} style={{ backgroundPosition, backgroundImage: 'url(' + url + ')' }} />` (lines 126–131).

The `gutenberg_replace_html` path with `source: attribute, selector: img, attribute: src` (the technique used by PR #74610) cannot touch the `<div style="background-image: url(...)">` form because:
1. The selector is `img`, not `div`.
2. Even if we matched the `div`, we'd need to mutate a CSS value inside the `style` attribute, which the HTML Tag Processor cannot do safely — there is no CSS Processor in the HTML API yet (referenced in PR #74610 description, third TODO item).

This is the documented "CSS-in-HTML rewrite" blocker that stalled PR #74610.

**Reasoning:** This is structurally why the prompt insists `hasParallax` must be **forced false at render time when bindings are active** — it sidesteps the HTML rewrite problem.

**Sources:** `packages/block-library/src/cover/save.js:67,99-132`; PR #74610 description (https://github.com/WordPress/gutenberg/pull/74610) "Support parallax case" TODO; `lib/compat/wordpress-6.9/block-bindings.php:346-398` (replace_html limited to attribute selectors).

### Q5: What invariant must the implementation enforce when the binding source returns a `url` but no `id` (the "external URL" case)?

**A:** Per the prompt's Scope-In: a bound `id` is required, and a bound `url` must be derivable from that `id`. Per Scope-Out: external/non-media-library URL binding is not supported. Per Architectural Constraint: "Internal-only invariant enforced visibly: when `url` is bound but `id` is missing (external), the UI must show that the binding cannot be honored, not silently render a broken Cover."

In practice this means:
- Both `id` and `url` are declared bindable in the supported-attributes filter, so both can be wired through a binding source.
- The Edit component must detect the (bound url, unbound or null id) state and surface a visible "cannot resolve internal media" affordance instead of rendering the cover as if the URL were valid.
- The reactive observer that derives `dimRatio`/overlay color must not run for url-only-bound covers (no `id` ⇒ no media-library resolution).
- On the server side, the same constraint should hold: if `id` is empty after binding resolution, skip the substituted-image insert path and render the cover as the unbound placeholder would render (no broken image element).

**Reasoning:** The Cover's overlay color, focal point and image-size derivation all require the attachment metadata (i.e. the `id`). Treating url-only bindings as best-effort would re-introduce all the edge cases that ballooned PR #74109 (alt text, sizeSlug, focal point on unknown image, average color derivation).

**Sources:** `0-prompt/prompt.md` Scope-In/Out and Architectural Constraints; PR #74610 TODO "Figure out what to do if only `url` is bound (but `id` isn't), meaning that the bound image could possibly be external" (https://github.com/WordPress/gutenberg/pull/74610).

### Q6: What is the architectural shape reviewer @ockham requires (and which prior approach he rejected)?

**A:** From his inline comment on PR #74109 (`packages/block-library/src/cover/edit/index.js`, line 282, posted 2026-01-13):

> "After working on #74610 for a while, I realize that this is a pattern that I'd like to avoid as much as possible. The block shouldn't need to care where it gets its attributes from -- i.e. if they're set manually or provided by a Block Binding. Instead, it should be as agnostic as possible. ... we should try to move that logic into one shared `useEffect` handler that will simply react to the `url`, `featuredImage`, `overlay` (and potentially other) attributes changing, and re-compute colors accordingly. This will cover both the case where the user makes a manual change, or the attribute is provided by Block Bindings."

His own follow-up acknowledges the tension: "I also just found out that this would mean we'd go full circle -- after previously moving code from `useEffect` into event handlers, since `useEffect` was deemed too fragile" (link to #53253).

He references the future `useEffectEvent` (React 19) as the cleanup path; `useEffectEvent` is already exported from `@wordpress/element` (verified at `packages/element/README.md:472`, `packages/element/build-module/react.mjs:23,97`).

The reviewer's hard requirements are therefore:
- **No** per-event `useEffect` proliferation (one for media-select, one for blur, one for focus, …).
- **One** observer (or a small number of well-named ones) that derives all dependent state from the bound id/url plus existing manual-edit triggers.
- The block must be **source-agnostic**: same derivation logic whether the URL came from a binding or a manual selection.

**Reasoning:** This determines the architectural shape — design phase must produce a single observer (likely keyed on `(url, useFeaturedImage, isUserOverlayColor)`), with stable references via `useEffectEvent` to avoid stale-closure pitfalls.

**Sources:** PR #74109 review comments via `gh api repos/WordPress/gutenberg/pulls/74109/comments`; `packages/element/README.md:472`; `packages/element/build-module/react.mjs:23,97`.

### Q7: How does `core/image` wire up its own URL/id bindings — what is the minimum reusable pattern Cover should mirror for control-locking?

**A:** `core/image` uses two patterns:

1. **Detecting whether the binding source allows editing.** In `packages/block-library/src/image/image.js` lines 745–820, a `useSelect` returns `lockUrlControls`, `lockHrefControls`, `lockAltControls`, etc., each derived from `metadata?.bindings?.<attr>` plus the bound source's `canUserEditValue` function:
   ```js
   lockUrlControls:
       !! urlBinding &&
       ! urlBindingSource?.canUserEditValue?.( {
           select, context, args: urlBinding?.args,
       } ),
   ```
2. **Hiding/disabling controls.** Throughout `image.js` and `edit.js`, the URL input, MediaReplaceFlow, and related controls are gated by `!lockUrlControls && ...`. For example `MediaReplaceFlow` only mounts when `!lockUrlControls` (`image.js:834-836`).

Pattern Overrides source returns `canUserEditValue: () => true` (`packages/editor/src/bindings/pattern-overrides.js:102`), so a pattern instance editing an overridden cover **does not** lock controls — the user is supposed to edit. For other sources (post-meta, etc.) where the user cannot edit the source value from inside the block, controls lock.

**Reasoning:** Cover should reuse the `lockUrlControls` derivation idea. The prompt explicitly enumerates which Cover controls must hide when bindings are active (parallax, repeat, media-replace, use-featured-image); the `lockUrlControls`-style boolean is one signal, but the prompt's actual requirement is broader: hide those four controls whenever **any** binding is present on `url` (or `id`), regardless of whether the source permits editing. The two layers (`hasUrlBinding` and `lockUrlControls`) need to coexist:
- `hasUrlBinding` → hide parallax / repeat / featured-image toggles (always).
- `lockUrlControls` → additionally hide media-replace if the source disallows editing.

For Pattern Overrides specifically, media-replace must **stay visible** (the user is supposed to override). For post-meta, it should hide.

**Sources:** `packages/block-library/src/image/image.js:734-820,822-849`; `packages/block-library/src/image/edit.js:396-461`; `packages/editor/src/bindings/pattern-overrides.js:102`.

### Q8: For Pattern Overrides specifically, what is the round-trip lifecycle for a Cover block (set in pattern → override per instance → reset to default → "reset hidden when default")?

**A:** Pattern Overrides uses the `core/pattern-overrides` binding source (`packages/editor/src/bindings/pattern-overrides.js`).

States:
1. **Authoring the pattern (`isEditingSyncedPattern` true).** The pattern editor shows `PatternOverridesControls` (`packages/patterns/src/components/pattern-overrides-controls.js`) which lets the author "Enable overrides" via a button; this calls `updateBlockBindings({ __default: { source: 'core/pattern-overrides' } })`. The block must have `metadata.name`. Setting `__default` to `core/pattern-overrides` causes `gutenberg_process_block_bindings` (`lib/compat/wordpress-6.9/block-bindings.php:257-281`) to expand the `__default` binding into one per supported attribute server-side.
2. **Default state on an instance (no override).** Per the source's `getValues`, the value returned is the block's own attribute value (the pattern default). On the server, `gutenberg_process_block_bindings` resolves the value the same way — no overrides means the binding returns the same value as the static save markup.
3. **Overridden state.** Editing the block in a pattern instance triggers `setValues`, which writes into the parent `core/block`'s `content` attribute under `[blockName].[attrName]`. The next render through bindings then resolves to the override value.
4. **Reset.** `ResetOverridesControl` (`packages/patterns/src/components/reset-overrides-control.js:14-90`) is a toolbar button: `isOverridden` is computed from `getBlockAttributes(patternClientId)?.content?.hasOwnProperty(name)`. When the user clicks Reset, it deletes that entry from `content`. The button is **disabled** (greyed) when `! isOverridden` — that is the "reset hidden when default" behavior the prompt mentions, except it's `disabled`, not `hidden`. The button toolbar always shows; only the button is disabled.

For the four states:
- (a) **default (no override):** the bound value === the block's own attribute, instance renders pattern default. ✅
- (b) **overridden:** content key present, value === override.
- (c) **reset-to-default with binding active:** user clicks Reset, content key deleted, attribute resolves back to pattern default.
- (d) **reset-hidden when value already matches default:** the ResetOverridesControl is `disabled` when not overridden. The prompt may mean "Reset hidden cleanly when the instance value already matches the default" — that's the existing behavior (disabled toolbar button, not hidden, but greyed).

**Reasoning:** State (d) needs design-phase clarification: prompt says "hide cleanly" but existing behavior is "disable". Either is acceptable UI; the design must pick one and stay consistent across all bindable blocks. Suggest staying with the existing `disabled` pattern unless there's a reason to diverge.

**Sources:** `packages/editor/src/bindings/pattern-overrides.js:1-103`; `packages/editor/src/hooks/pattern-overrides.js:1-122`; `packages/patterns/src/components/pattern-overrides-controls.js:1-127`; `packages/patterns/src/components/reset-overrides-control.js:1-90`; `lib/compat/wordpress-6.9/block-bindings.php:257-281`.

### Q9: How does Cover's `useFeaturedImage` flow currently differ from the bindings flow, and why must the two never both be active on the same block?

**A:** `useFeaturedImage` is a Cover-specific dynamic-image mechanism that pre-dates Block Bindings. It is a boolean attribute (`block.json:14-17`). When true, Cover's `edit/index.js` (lines 137–154) overrides the displayed URL with `mediaUrl` derived from the post's `featured_media`, and the server (`packages/block-library/src/cover/index.php:133-199`) injects an `<img>` for the post thumbnail.

The two paths are mutually exclusive by intent because:
- Both want to dictate `url`/`id` at render time.
- `useFeaturedImage` updates the rendered image when the post's featured image changes, **without** going through bindings.
- A bound `url`/`id` is supposed to be source-of-truth for the displayed image; `useFeaturedImage` would conflict.

Per prompt: when binding is active, the "Use featured image" toggle hides. The edit component must NOT mutate `useFeaturedImage` (no attribute mutation invariant); instead, when computing the displayed image at render time, the binding-resolved `url`/`id` must take precedence over `useFeaturedImage`'s `mediaUrl`.

For previously-saved blocks where `useFeaturedImage=true` AND a binding is then attached: the design must specify the precedence rule. The simplest is: binding wins for resolved `url`/`id`; on the server, if the binding is on `id`/`url`, the `useFeaturedImage` branch in `render_block_core_cover` must NOT also fire (it would try to inject a second image). The render callback must short-circuit `useFeaturedImage` when bindings have resolved a value.

**Reasoning:** Featured-image binding (`useFeaturedImage` + binding combined) is explicitly OUT of scope per prompt ("Featured-image binding for Cover (`useFeaturedImage` + binding). Separate follow-up PR."). But in-scope is hiding the toggle and preventing UI/server-render conflict when both happen to be set.

**Sources:** `packages/block-library/src/cover/block.json:14-17`; `packages/block-library/src/cover/edit/index.js:119-201`; `packages/block-library/src/cover/index.php:133-200`; prompt Scope-Out item 3.

### Q10: What is the precise default-`dimRatio: 100` behavior, and where must the effective value override live?

**A:** `block.json:33-36` declares `"dimRatio": { "type": "number", "default": 100 }`. The save serialization in `save.js:168-186` writes a `.has-background-dim` span with `dimRatioToClass(dimRatio)`. From `shared.js:32-36`: ratio 50 or undefined → null class, else `has-background-dim-{10*round(ratio/10)}`. So `dimRatio=100` → `has-background-dim-100` → fully opaque overlay.

Today, when a user inserts a Cover and then sets media, `onSelectMedia` (`edit/index.js:218-291`) downshifts `dimRatio` from 100 → 50 (line 244: `const newDimRatio = currentAttrs.url === undefined && currentAttrs.dimRatio === 100 ? 50 : currentAttrs.dimRatio;`). This is an attribute-mutating side effect of the event handler.

With bindings, the same downshift cannot happen via an event handler — the URL appears via the binding, not via `onSelectMedia`. PR #74610's approach was to also downshift in a `useEffect` (lines around the `[ url ]` dep). That mutates the attribute.

The prompt forbids attribute mutation from the binding-detection observer. So the implementation must instead compute an **effective `dimRatio` at render time** when:
- A binding is active, **and**
- The stored `dimRatio` is the default (100), **and**
- The resolved URL is non-empty.

In that case the rendered overlay should use 50 (or some configured derived value) without writing to the attribute. The editor preview uses this effective value; the server render must apply the same logic.

This breaks symmetry with the static `save.js` markup (which writes `has-background-dim-100` when the attribute is 100). So on the server, `render_block_core_cover` must inspect `metadata.bindings.url` (or `id`) and rewrite the `wp-block-cover__background` span's class to use the effective value when binding is active. This is an HTML-tag-class rewrite, which the HTML Tag Processor handles cleanly (unlike CSS-in-style attributes).

**Reasoning:** Centralising the effective-value derivation in render-time (both client edit preview and server render) preserves the "no attribute mutation" invariant while solving the opaque-overlay problem. The class-rewrite is mechanically straightforward because the relevant element is `<span class="wp-block-cover__background has-background-dim has-background-dim-100">` — a class change, not a style change.

**Sources:** `packages/block-library/src/cover/block.json:33-36`; `packages/block-library/src/cover/save.js:168-186`; `packages/block-library/src/cover/shared.js:32-36`; `packages/block-library/src/cover/edit/index.js:218-291` (especially line 244); PR #74610 description "TODO: Binding a newly inserted Cover block ... adds an overlay that uses the `dimRatio` attribute default value of `100`".

### Q11: How does overlay color "auto-derive from image average" currently work, and how does it need to change for bindings?

**A:** `edit/index.js:163-201,218-291,503-547` calls `getMediaColor( imageUrl )` from `edit/color-utils.js` (returns the average colour of the image, async). The result is set as the overlay color via `setOverlayColor` (a `withColors` setter) provided `isUserOverlayColor` is false.

Today this only runs in event handlers: `onSelectMedia`, `toggleUseFeaturedImage`, and one `useEffect` reacting to `mediaUrl` changes for `useFeaturedImage`.

For bindings, the URL can change without an event (the bound source updates externally). Per @ockham's review (Q6), this is exactly the case the single observer should cover: react to `url` changing for any reason. The PR #74610 approach extended the `useEffect` to also fire when `attributes?.metadata?.bindings?.url` is present. The cleaner approach (per @ockham) is to make the observer source-agnostic — it observes `url` directly (the destructured value that already accounts for both `useFeaturedImage` and manual selection), guarding only against `isUserOverlayColor`.

Edge cases that must NOT regress:
- User explicitly sets overlay color (`isUserOverlayColor=true`) → auto-derive must not overwrite.
- URL changes from binding to a different image → auto-derive must run.
- URL clears (binding source returns undefined) → overlay returns to default (or stays where it was if user-set).
- Concurrent async race: `getMediaColor` is async; if the URL changes again before resolution, the stale colour must not overwrite the newer one (the existing code uses a `propsRef` pattern at `edit/index.js:130-135` for this).

**Reasoning:** Same observer that derives `dimRatio` also derives `overlayColor` (only when not user-set). One reactive callback keyed on the effective `url`, with a `propsRef` (or `useEffectEvent`) to read latest `isUserOverlayColor`/`dimRatio` without stale closure.

**Sources:** `packages/block-library/src/cover/edit/index.js:127-201,218-291,503-547`; `packages/block-library/src/cover/edit/color-utils.js` (referenced); PR #74609 review (linked from #74109 comments).

### Q12: How is the Block Bindings UI gated for Cover, and is anything blocking it from appearing today?

**A:** The Block Bindings panel in `packages/block-editor/src/hooks/block-bindings.js:40-100` calls:
```js
bindableAttributes:
    __experimentalBlockBindingsSupportedAttributes?.[ blockName ],
```
And renders one row per attribute in `bindableAttributes`. The setting is populated server-side from `gutenberg_get_block_bindings_supported_attributes(block_type)`, which returns an empty array for `core/cover` today (no entry in the 6.8 snapshot, no filter adds it; `lib/compat/wordpress-6.9/block-bindings.php:118-167`).

There is also an excluded-blocks list `BLOCK_BINDINGS_PANEL_EXCLUDED_BLOCKS` introduced in branch `try/75022-block-bindings-into-block-fields` (`packages/block-editor/src/components/block-bindings/excluded-blocks.js`):
```js
export const BLOCK_BINDINGS_PANEL_EXCLUDED_BLOCKS = [
    'core/post-date',
    'core/navigation-link',
    'core/navigation-submenu',
];
```
**Cover is not in this list**, so once the supported-attributes filter adds `id`/`url`, the bindings UI will render the two attribute controls automatically.

Pattern Overrides "Enable overrides" button (`PatternOverridesControls`) is also gated on `__experimentalBlockBindingsSupportedAttributes?.[blockName]` being truthy (`packages/editor/src/hooks/pattern-overrides.js:39-58`), so adding the filter entry also unlocks Pattern Overrides for Cover. No additional Pattern-Overrides allow-list exists for blocks (it's gated purely on having any bindable attribute).

**Reasoning:** The single PHP filter addition is the master switch. No additional client-side allow-listing is required.

**Sources:** `packages/block-editor/src/hooks/block-bindings.js:40-100`; `packages/block-editor/src/components/block-bindings/excluded-blocks.js` (on `try/75022-block-bindings-into-block-fields`); `packages/editor/src/hooks/pattern-overrides.js:37-58`; `lib/compat/wordpress-6.9/block-bindings.php:118-167`.

### Q13: What does the Block Fields UI (sibling pipeline `75022-block-bindings-into-block-fields`) require from a "bindable block"?

**A:** Per branch `try/75022-block-bindings-into-block-fields`, the relevant additions are:
- `packages/block-editor/src/components/block-bindings/use-block-bindings-compatible-fields.js` — a new hook that lists compatible binding sources for a given (block, attribute) pair, filtering by attribute `type`.
- `packages/block-editor/src/components/block-bindings/excluded-blocks.js` — excludes a small list (cover not in it).
- `packages/block-editor/src/components/block-bindings/attribute-control.js` — refactored to use the shared hook.

The Block Fields UI surfaces bindable attributes through DataForm/DataView controls. A block needing to integrate with Block Fields needs:
- An entry in `__experimentalBlockBindingsSupportedAttributes` (server-side allow-list).
- Attribute `type` declared in `block.json` (Cover's `url`=string, `id`=number — both already declared).
- Not be in `BLOCK_BINDINGS_PANEL_EXCLUDED_BLOCKS`.
- An indicator that the attribute participates in "content" via `role: "content"` (Cover has it on `url`; `id` does not — recommended to add).

Beyond those, no Cover-specific changes are needed to integrate with the Block Fields UI; the integration is automatic once the supported-attributes filter is in place.

**Reasoning:** The 75022 work is generic across blocks. Cover-specific bindings work needs to not regress that integration; the design must verify Block Fields renders correctly for a bound Cover.

**Sources:** `git diff trunk..try/75022-block-bindings-into-block-fields --stat -- packages/block-editor/src/components/block-bindings/`; the new files on that branch listed above.

### Q14: What e2e test pattern exists for Block Bindings on existing blocks?

**A:** The directory `test/e2e/specs/editor/various/block-bindings/` contains:
- `custom-sources.spec.js` — tests image/paragraph/heading bindings against a fixture source registered by `packages/e2e-tests/plugins/block-bindings.php`.
- `post-meta.spec.js` — tests post-meta source on image/paragraph/heading/button.
- `post-data.spec.js` — tests post-data source.

The fixture source (`packages/e2e-tests/plugins/block-bindings.php`) registers a `testing/complete-source` with text and url fields, including an image URL pointing at a fixture file uploaded as media via `requestUtils.uploadMedia`.

Pattern Overrides e2e lives in `test/e2e/specs/editor/various/pattern-overrides.spec.js` (no Cover/image-specific cases currently). The pattern is: create a synced pattern with a bound block, insert the pattern in a post, override one instance, assert the rendered front-end output via the post-preview / front-end navigation.

PR #74610 added a Cover-specific e2e (`test/e2e/specs/editor/blocks/cover.spec.js` describe block "Block Bindings") that asserts overlay color/opacity for a bound `url` resolves correctly. The pipeline's PR should include similar coverage for:
1. `id`+`url` bound via Pattern Overrides — instance shows pattern default.
2. Same block, override instance → asserts the rendered image src changes.
3. Reset override → asserts back to default.
4. Hidden controls assertion: parallax/repeat/replace/use-featured-image toggles are not in the DOM when binding active.

**Reasoning:** The infrastructure exists; the spec should land in `test/e2e/specs/editor/blocks/cover.spec.js` (extending the existing Cover describe block) and/or `test/e2e/specs/editor/various/pattern-overrides.spec.js` if a synthesis test makes sense across blocks.

**Sources:** `test/e2e/specs/editor/various/block-bindings/`; `test/e2e/specs/editor/various/pattern-overrides.spec.js`; `packages/e2e-tests/plugins/block-bindings.php`; PR #74610 diff adding Cover e2e.

### Q15: What about `backgroundType: "embed-video"` — does it interact with bindings?

**A:** `backgroundType: "embed-video"` was added to Cover after both prior bindings PRs were drafted. The server render (`packages/block-library/src/cover/index.php:20-131`) returns the embed iframe markup and **does not pass through to the bindings branch** for embed videos. The edit flow (`packages/block-library/src/cover/edit/index.js:366-415`) treats embed URLs as a separate branch via `onSelectEmbedUrl`.

Per prompt Scope-Out: embed-video × bindings is OUT of scope. Per risk #3: "Confirm bindings UI does not appear or short-circuits when this is the active background type."

Concretely:
- The Block Bindings panel does **not** know about `backgroundType` and will show the `id`/`url` controls regardless. The implementation has two choices:
  1. Leave the panel as-is and let the user bind a URL even with `backgroundType=embed-video`; the resolved URL will be treated as an embed (existing edit code path). This is the simplest but allows nonsensical combinations.
  2. Hide the bindings UI controls when `backgroundType=embed-video` (requires custom logic outside the generic Block Bindings panel).
- The simpler choice (1) keeps the panel generic and lets the user bind. The bound `url` value would flow into the embed flow as-is. The risk: a Pattern Overrides scenario where the pattern's Cover has an image background and an instance override sets `backgroundType=embed-video` is not a realistic flow — `backgroundType` itself is not bindable.

Recommended in-scope handling: leave the bindings panel UI as-is (show controls); but in the edit component, when `backgroundType=embed-video`, the binding-aware derivation (effective `dimRatio`, overlay colour) should short-circuit (the embed-video branch already overrides display). The "hide parallax/repeat/replace/featured-image" rule still applies but is moot because those controls are already hidden for embed-video backgrounds in `inspector-controls.js`.

**Reasoning:** Embed-video is a separate background type with its own render path. Bindings on `url` for an embed-video cover would mean "bind the embed URL", which is a coherent (if narrow) use case. Out-of-scope per prompt means we don't add bespoke logic for it; we just ensure existing embed-video covers don't regress.

**Sources:** `packages/block-library/src/cover/index.php:19-131`; `packages/block-library/src/cover/edit/index.js:366-415,420-422`; prompt Scope-Out item 4.

### Q16: Should `id` declare `role: "content"` like `core/image` does?

**A:** `core/image` declares `role: "content"` on both `url` and `id` (`packages/block-library/src/image/block.json:25-31,78-81`). `core/cover` currently has it on `url` only. To stay consistent with image and to participate cleanly in any future Block Fields / content-role tooling, the design should add `"role": "content"` to `id` as well.

This is a `block.json` change. It does NOT affect deprecation (no source/save shape change for the attribute), but it does affect what tools consider "content". Deprecation tests should be checked to confirm no behavioural change.

**Reasoning:** Minimal change, increases consistency with the canonical pattern set by `core/image`. The prompt does not explicitly mention it, but it's a natural part of "make `id` and `url` bindable end-to-end".

**Sources:** `packages/block-library/src/cover/block.json:18-20`; `packages/block-library/src/image/block.json:78-81`.

### Q17: What server-side approach should the PR use to make the rendered HTML reflect bound values + the "effective dimRatio" + the "force hasParallax=false" rule?

**A:** There are two viable approaches (the design phase must choose; this Q only enumerates the constraints):

**Approach A — Add a custom `render_block` filter scoped to Cover.** The new `lib/compat/wordpress-7.1/block-bindings.php` (or `packages/block-library/src/cover/index.php`) would intercept the Cover's `render_block` and, when `metadata.bindings.url` (or `id`) is set:
1. Resolve the bound value via `gutenberg_process_block_bindings`.
2. Use the HTML Tag Processor to find the `<img class="wp-block-cover__image-background">` (or `<div ...>` if parallax) and rewrite `src` (or, if the saved markup is the parallax div, replace the div with an `<img>`).
3. Rewrite the `wp-block-cover__background` span's class to use the effective `dimRatio` (i.e. swap `has-background-dim-100` → `has-background-dim-50`).
4. Strip `has-parallax` and `is-repeated` classes from any element that has them.

**Approach B — Generic `block_bindings_attribute_replaced_in_markup` filter** (PR #74610's approach). Synthesize `source: attribute, selector: img, attribute: src` for Cover's `url`, and rely on `gutenberg_replace_html`. Cover's `render_block_core_cover` would additionally need to handle the dimRatio/parallax/repeat class adjustments (Approach A's points 3–4).

Constraints either approach must honour:
- The bound `url` may or may not be derivable from an `id`; if `id` resolves to nothing, the substitution must NOT proceed and the cover should render without the broken image element (Q5 invariant).
- The featured-image branch in `render_block_core_cover` must NOT also fire when bindings have resolved a value (Q9 mutual exclusion).
- The class rewrite for dimRatio must be idempotent and safe across `style` variations.
- No CSS-in-style-attribute rewriting (Q4 blocker).

Either approach lands in `lib/compat/wordpress-7.1/block-bindings.php`. Approach B has minor reuse value for other blocks; Approach A is simpler and entirely block-scoped (less risk of unintended interaction with other blocks).

**Reasoning:** This is a design-phase decision; the requirements only need to capture the constraints. The selected approach must explicitly preempt the parallax CSS-in-HTML issue and the dimRatio default issue per Q4 and Q10.

**Sources:** PR #74610 diff (Approach B precedent); `lib/compat/wordpress-6.9/block-bindings.php:57-108,346-398`; `packages/block-library/src/cover/index.php` (existing render_block_core_cover, where Approach A would extend).

### Q18: What is the precise list of UI controls to hide when a binding is active, and what gates each?

**A:** Per prompt Scope-In:
1. **Parallax toggle (`hasParallax`)** — gate: any binding on `url` (or `id`). Source: `packages/block-library/src/cover/edit/inspector-controls.js` (today the toggle is unconditionally rendered when `isImageBackground`; needs `!hasUrlBinding` gate).
2. **Repeat toggle (`isRepeated`)** — same gate as parallax. Source: same file.
3. **Media-replace control** — gate: `hasUrlBinding && !canEdit` (i.e. `lockUrlControls` ; for Pattern Overrides source which allows edits, the control stays visible — but only via the binding's replace flow, not direct edit). Need to confirm: prompt says "Hide the media-replace control (replacement happens via the binding source, not direct edit)" — this suggests always hide when bound, even for Pattern Overrides. The Pattern Overrides override flow uses the existing media-replace UI to set the override, so we need to keep it visible for Pattern Overrides but route it through `setValues`. **This is ambiguous in the prompt** — see open question OQ-1.
4. **"Use featured image" toggle (`useFeaturedImage`)** — gate: any binding on `url` or `id`. Source: `packages/block-library/src/cover/edit/block-controls.js` and `inspector-controls.js`.

Additional implicit hides:
- Pattern Overrides "Enable overrides" button (already gated on bindable attributes existing) → no change needed.
- Reset toolbar button (per existing `ResetOverridesControl`) → already exists; design phase decides whether to apply the prompt's "hide cleanly when default" rule.

**Reasoning:** Each control needs an explicit gate, not a generic `lockUrlControls`. The prompt's "media-replace control" hide vs. Pattern Overrides flow needs clarification — see OQ-1.

**Sources:** `packages/block-library/src/cover/edit/inspector-controls.js:222-260,468`; `packages/block-library/src/cover/edit/block-controls.js`; prompt Scope-In bullet list.

### Q19: What about the saved (static) HTML? Does deprecation need updating?

**A:** `block.json` and `save.js` do not change shape under this PR (no new attributes; no changed serialization). Adding `role: "content"` to `id` is metadata-only.

If the implementation chooses to add `role: "content"` to `id`, no deprecation entry is needed — `role` is editor-only metadata, not part of the block markup.

The Cover block has an extensive `deprecated.js` (existing). Adding a deprecation is only needed if a saved-markup change is introduced. Per prompt Architectural Constraint "No attribute mutation on binding detection", and per render-time effective values, there is no saved-markup change anticipated.

**Reasoning:** Confirm during design that no `save.js` shape changes are required; if any do creep in, a deprecation entry becomes necessary.

**Sources:** `packages/block-library/src/cover/deprecated.js` (existing deprecations); prompt Architectural Constraints.

### Q20: What is the expected acceptance test for "PR diff under ~500 net lines"?

**A:** Per prompt Acceptance Criteria: "PR diff is targeted (~under 500 net lines including tests). Architectural cleanliness gates scope."

Counting net additions across affected files:
- New file `lib/compat/wordpress-7.1/block-bindings.php` — ~50-120 lines (filter + optional render_block hook).
- Optionally update `packages/block-library/src/cover/index.php` — ~30-60 net lines (render-time class/parallax/dimRatio adjustments).
- `packages/block-library/src/cover/block.json` — +1 line (role on id).
- `packages/block-library/src/cover/edit/index.js` — net additions for: `hasUrlBinding`/`lockUrlControls` derivation (~30 lines), single observer (~30 lines), effective-value derivation for url and dimRatio at render (~20 lines). Aim ~80 net lines added, some replacements.
- `packages/block-library/src/cover/edit/inspector-controls.js` — gating of parallax/repeat (~10 lines).
- `packages/block-library/src/cover/edit/block-controls.js` — gating of media-replace/featured-image (~10 lines).
- E2E test: extend `test/e2e/specs/editor/blocks/cover.spec.js` with a new describe block (~80-120 lines).
- Possibly fixture image upload helper.

Total estimated: ~280-450 net lines. Reasonable to land under 500 if the server-side approach is concise.

**Reasoning:** The budget is achievable; the main risk is the server-side render path bloating if Approach A is chosen and includes extensive HTML processing. The design should aim for the smallest possible server-side delta.

**Sources:** Estimated against file sizes from `wc -l`; prompt Acceptance Criteria.

### Q21: What is the expected commit / branch / PR target metadata?

**A:** Per prompt Repo Target:
- Branch (local worktree): `worktree-77199-cover-bindings-id-url-internal` (current branch).
- PR target: `WordPress/gutenberg` `trunk`, from `cbravobernal/gutenberg` fork.
- PR description must link #77199 and explicitly state which prior issues (#74109, #74610) it does and does not subsume.
- Backport-changelog entry under `backport-changelog/7.1/` (PR #74610 used `backport-changelog/7.0/10739.md` since it was 7.0-scoped; this one is 7.1).

**Reasoning:** Standard pipeline metadata.

**Sources:** Prompt Repo Target section.

### Q22: Are there any blockers — does any premise in the prompt contradict codebase reality?

**A:** No outright contradictions. Areas where the prompt is slightly under-specified but not contradicted:
- The phrasing "force `hasParallax=false` for the rendered output" implies a server-side rewrite of the saved markup when the saved markup baked in parallax. Codebase reality (Q4) confirms parallax saved markup is `<div style="background-image: url(...)">`, and the HTML API cannot edit CSS in `style`. The implementation must either:
  - (a) On the server, when bindings are active, *replace* the `<div style="background-image">` element with `<img src="">` entirely (no CSS edit needed, just element swap), OR
  - (b) Rely on the fact that bound covers are typically authored in patterns where `hasParallax` is not turned on, AND hide the parallax control before the user can set it on an already-bound cover.
  
  Option (a) is feasible with HTML Tag Processor (the `<div>` is uniquely identifiable by its class `wp-block-cover__image-background`).
  
  This is not a blocker — it's an implementation choice with two viable paths. Captured as design constraint.

- The phrasing "reset hidden cleanly when the instance value already matches the default" — existing `ResetOverridesControl` disables the button rather than hides it. The prompt may be using "hidden" loosely. Captured as open question OQ-2.

No blockers; proceeding.

**Reasoning:** Standard sanity sweep of prompt assumptions against actual code.

**Sources:** Q4, Q8, Q15, Q17 above.

## Research

### Cover block source layout (current trunk)

- `packages/block-library/src/cover/block.json` (158 lines): attribute schema. `url` (string, role: content), `id` (number, no role), `useFeaturedImage` (boolean), `hasParallax` (boolean, default false), `isRepeated` (boolean, default false), `dimRatio` (number, default **100**), `overlayColor`, `customOverlayColor`, `isUserOverlayColor`, `backgroundType` (default "image"), `focalPoint`, `minHeight`, `gradient`, `customGradient`, `contentPosition`, `isDark` (default true), `templateLock`, `tagName` (default "div"), `sizeSlug`, `poster`.
- `packages/block-library/src/cover/save.js` (195 lines): serialises to `<Tag>` wrapper with classes; image background as `<img>` if `!hasParallax && !isRepeated` else `<div style="background-image: url(...)">`; overlay span with `has-background-dim has-background-dim-{N}` class.
- `packages/block-library/src/cover/index.php` (216 lines): `render_block_core_cover` handles embed-video and useFeaturedImage paths; otherwise returns `$content` as-is.
- `packages/block-library/src/cover/edit/index.js` (767 lines): main React component. Contains `useEffect` for `useFeaturedImage`-driven mediaUrl observer; event handlers `onSelectMedia`, `onClearMedia`, `onSetOverlayColor`, `onUpdateDimRatio`, `toggleUseFeaturedImage`, `onSelectEmbedUrl`. Uses `propsRef` pattern (`useLayoutEffect`) to avoid stale closures across async `getMediaColor` calls.
- `packages/block-library/src/cover/edit/inspector-controls.js` (468 lines): ToolsPanel with fixed background (parallax), repeated background, focal point, alt, image-size, overlay color, dim ratio, min-height, tag name.
- `packages/block-library/src/cover/edit/block-controls.js` (151 lines): BlockControls toolbar group: media-replace, focal-point, full-height, content-position, "Use featured image".

### Image block bindings wiring (reference pattern)

- `core/image` has `id` (number, role: content), `url` (string, role: content, source: attribute, selector: img, attribute: src), `alt`, `title`, `caption`, `href` all with bindable roles.
- `lockUrlControls` boolean derived via `useSelect` in `image.js:745-820`, used to gate URL input, MediaReplaceFlow, and other URL-dependent controls (lines 822–849, 934–945).
- Pattern Overrides on image: existing e2e at `test/e2e/specs/editor/various/pattern-overrides.spec.js` lacks image-specific cases (verified via grep) — i.e. image bindings are exercised by `custom-sources.spec.js` and `post-meta.spec.js` only.

### Server-side bindings flow (WP 6.9 compat)

`lib/compat/wordpress-6.9/block-bindings.php`:
- Adds caption/datetime/navigation-link URL support via `block_bindings_supported_attributes` filter (lines 11-31).
- Exposes `__experimentalBlockBindingsSupportedAttributes` editor setting (lines 33-46).
- `gutenberg_block_bindings_render_block` (lines 57-108): processes bindings, merges resolved values into instance attributes, re-renders the block, then iterates resolved attributes calling `gutenberg_replace_html`.
- `gutenberg_replace_html` (lines 346-398): only handles `source: html|rich-text|attribute`; uses HTML Tag Processor to swap content or attribute values per the attribute's declared selector.
- `gutenberg_process_block_bindings` (lines 209-333): expands `__default` (pattern-overrides) into per-attribute bindings; resolves each binding via the source's `get_value`.

### Prior-attempt evidence (NOT inheritance)

Branch `add/cover-block-bindings-support-v2` (most recent commit `565e655b70e`, 2026-01-13):
- 44 files changed, +775/-6038 lines (severely rotted; conflicts with current 7.0/7.1 dirs that no longer exist on this branch).
- The cover-relevant changes: `block.json` unchanged from trunk, `index.php` adds a `has_url_binding` branch and the `block_core_cover_insert_image_before_inner_container` helper, `edit/index.js` adds `hasImageBinding` state with multiple `useEffect`s reacting to mediaUrl, originalUrl, hasImageBinding, etc., and `lockUrlControls` via `canUserEditValue`. Also adds Pattern-Overrides reset shortcut in `onClearMedia`. Adds `dimRatioInitialized` state to gate the 100→50 downshift.
- This is the architecture @ockham rejected (Q6). Harvest fragments: the `has_url_binding` server-side branch is useful evidence for Approach A in Q17, but mutates attributes (e.g. `setAttributes({useFeaturedImage: false})` from inside `useEffect`) — violates the "no attribute mutation on binding detection" invariant.

Branch `add/cover-block-bindings-support` (older, `721cefb818c` "Fix dim"):
- 5 commits. Earlier exploration; superseded by v2.

PR #74610 (draft, open as of fetch time, title "Block Bindings: Add support for Cover block id and url attrs"):
- Body acknowledges: dimRatio 100 default issue (resolved by downshift in useEffect); url-only-bound external image not handled; parallax not supported due to CSS-in-style.
- Adds `block_bindings_attribute_replaced_in_markup` filter to synthesise sourced-attribute metadata for Cover's url at runtime.
- Adds Cover bindings e2e in `test/e2e/specs/editor/blocks/cover.spec.js` asserting overlay color/opacity.
- Reviewer comments include the architectural request (Q6) and a note to move backport-changelog to `7.1/`.

PR #74109 (draft, open, title "Block Bindings: Add Cover block support."):
- Reviewer @ockham flagged the event-handler-keyed `useEffect` approach (comment at edit/index.js:282) and suggested the source-agnostic single-observer refactor (Q6).
- Multiple TODOs around video bg, featured image, e2e, reset-hidden default. Many resolved in subsequent commits.

### Pattern Overrides reset semantics

- `core/pattern-overrides` source defined at `packages/editor/src/bindings/pattern-overrides.js`; `getValues` returns block's own attribute when not overridden, override value when set; `setValues` writes into the parent `core/block`'s `content` attribute.
- `ResetOverridesControl` (toolbar button) `disabled` when not overridden — that's the existing "hidden when default" semantics. May be revisited in design phase per OQ-2.
- Server-side `__default: core/pattern-overrides` expansion: `lib/compat/wordpress-6.9/block-bindings.php:257-281` — when a block has `metadata.bindings.__default.source = core/pattern-overrides`, all `supported_block_attributes` are auto-bound to pattern overrides.

### `useEffectEvent` availability

Confirmed exported from `@wordpress/element` (referenced in `packages/element/README.md:472` and `packages/element/build-module/react.mjs:23,97`). This is the recommended primitive (React 19) for letting `useEffect` body call functions whose latest props/state are read without those values being in the dep array — directly enables @ockham's single-observer pattern without the stale-closure pitfalls.

### Open questions for the design phase

- **OQ-1.** When a Pattern Overrides override is active, does the Cover block's MediaReplaceFlow stay visible and write the override (via `setValues`), or is it hidden in favour of editing the override only from outside the cover? Prompt says "Hide the media-replace control" but Pattern Overrides typically uses the existing replace flow to author the override. Design must resolve.
- **OQ-2.** Should the "Reset to default" affordance be **disabled** (existing `ResetOverridesControl` behaviour) or **hidden** (prompt phrasing "hide cleanly when default")? Recommend disable, matches existing behaviour and is consistent with other bindable blocks.
- **OQ-3.** Server-side approach: Approach A (cover-specific render filter) vs Approach B (generic `block_bindings_attribute_replaced_in_markup` filter from #74610). Design phase to pick based on simplicity and reuse value.
- **OQ-4.** When a Cover with `hasParallax=true` and `isRepeated=true` already in saved markup gains a binding via "Enable overrides", what should happen on the server render? Option: replace the `<div style="background-image">` element with `<img>`, dropping `style` entirely, and ensure overlay span class drops `has-parallax`/`is-repeated` if present. Captured here so the design picks an explicit rule.
- **OQ-5.** Is there any restriction on which binding sources `id`+`url` should expose (e.g. require both attributes to bind to the same source)? Prompt's "Internal-only invariant" implies yes — design phase to specify the validation.

## Consolidated Requirements

The following is a numbered list of all requirements the implementation must satisfy. Each captures WHAT, not HOW.

### A. Block-level metadata and registration

1. The `id` attribute on `core/cover` (`packages/block-library/src/cover/block.json`) MUST be marked as a content-role attribute consistent with `core/image` (i.e. declare `"role": "content"`).
2. A new file `lib/compat/wordpress-7.1/block-bindings.php` MUST be created and required from `lib/load.php`. It MUST register a filter that adds `'id'` and `'url'` to `gutenberg_get_block_bindings_supported_attributes('core/cover')`.
3. The implementation MUST NOT change the schema of any other attribute in `core/cover`'s `block.json`. No new attributes are introduced.

### B. Editor (client) — UI gating

4. When a binding is present on `core/cover`'s `url` (or `id`), the parallax toggle (`hasParallax`) in the inspector controls MUST be hidden.
5. When a binding is present on `core/cover`'s `url` (or `id`), the repeated-background toggle (`isRepeated`) in the inspector controls MUST be hidden.
6. When a binding is present on `core/cover`'s `url` (or `id`), the "Use featured image" toggle MUST be hidden (both in block toolbar and in any other surface where it appears).
7. When a binding is present AND the bound source's `canUserEditValue` returns false, the media-replace control MUST be hidden. (Design phase resolves OQ-1 for the Pattern Overrides case.)
8. The Block Bindings UI (legacy Attributes panel and any Block Fields UI) MUST render bindable rows for `id` and `url` on `core/cover` automatically, without Cover-specific UI code, by virtue of requirement 2.
9. Pattern Overrides controls (`Enable overrides` button, `ResetOverridesControl` toolbar button) MUST work for `core/cover` without Cover-specific changes, by virtue of requirement 2.

### C. Editor (client) — reactive derivation

10. The Edit component MUST contain a single reactive observer (one `useEffect` or equivalent, using `useEffectEvent` to access latest non-observed values without stale closures) that derives **all** dependent state from the effective `url` (and `id` where relevant) regardless of whether the URL is provided manually, by `useFeaturedImage`, or by a binding source.
11. The reactive observer MUST NOT write to attributes on detection that a binding is present. Specifically: it MUST NOT mutate `dimRatio`, `useFeaturedImage`, `backgroundType`, `id`, `url`, or any other attribute as a side-effect of a binding becoming active or inactive.
12. The reactive observer MUST update the overlay colour from the resolved image's average colour when `isUserOverlayColor` is false, irrespective of how the URL was set.
13. The reactive observer MUST be resilient to concurrent async resolution of `getMediaColor` such that a stale resolved colour does not overwrite a newer one (the existing `propsRef`/`useEffectEvent` pattern).

### D. Editor (client) — effective values at render time

14. When a binding is active on `url`/`id`, the `dimRatio` used to compute the displayed overlay opacity MUST be derived at render time. If the stored `dimRatio` is the default value (100) and the bound URL resolves to a non-empty value, the rendered overlay MUST use a non-opaque effective value (target: 50). The stored attribute MUST NOT be changed.
15. The effective `url` used by the edit preview MUST give precedence to a bound `url` over `useFeaturedImage`'s `mediaUrl`. If both are present, the bound value wins; `useFeaturedImage`'s value is ignored at render.
16. When `url` is bound but `id` is unset (or vice versa, in any combination that cannot be resolved against an attachment in the media library), the edit component MUST surface a clear "internal media required" UX — for example, a visible message in the placeholder or inspector — rather than rendering the cover with a broken image element. The chosen surface is a design decision; the visibility requirement is the constraint.

### E. Server — render correctness

17. The server-side rendered markup for a Cover block with bindings on `id`/`url` MUST contain an `<img>` (not a `<div style="background-image: ...">`) for the resolved internal-media image, even if the saved markup serialised the parallax/repeat path. Parallax styling MUST be effectively off in the rendered output when bindings are active.
18. The server-side rendered overlay span MUST use the effective `dimRatio` derived per requirement 14 (i.e. swap `has-background-dim-100` → `has-background-dim-50` class when the saved attribute is 100 and bindings have resolved a value).
19. The server render MUST short-circuit the `useFeaturedImage` branch in `render_block_core_cover` when bindings have resolved a value for `url` and/or `id`, to prevent double-insertion of an image element.
20. The server render MUST resolve `url` and `id` consistently — if `id` cannot be resolved to a media-library attachment (or if `url` cannot be derived from the resolved `id`), the cover MUST render without an image element (no broken `<img>`).
21. The server-side bindings-resolution mechanism (whether via the `block_bindings_attribute_replaced_in_markup` filter or a Cover-scoped render_block hook — design phase decides) MUST be additive only: it MUST NOT change the behaviour of any other block whose attribute uses `gutenberg_replace_html`.

### F. Cross-cutting invariants

22. Unbound Cover behaviour MUST be unchanged: no regression on parallax, repeat, focal point, featured image, embed-video, dim ratio, overlay colour, alt text, image-size selection.
23. Pattern Overrides on Cover MUST round-trip cleanly through editor save/load and server render for the four enumerated states: (a) default (no override), (b) overridden, (c) reset-to-default with binding active, (d) reset-disabled-or-hidden when the instance value already matches the default. (OQ-2 resolves disabled vs hidden.)
24. External (non-media-library) URL binding MUST NOT be silently honoured. If a binding source returns a `url` without a corresponding resolvable `id`, the cover MUST treat the binding as unresolvable per requirement 16 (editor) and requirement 20 (server).
25. `backgroundType: "embed-video"` MUST continue to render correctly and MUST NOT regress. The bindings UI is allowed to expose `url` for binding even when `backgroundType=embed-video`; no Cover-specific suppression of the bindings panel is required, but the binding-aware derivations (effective dimRatio, overlay colour) SHOULD short-circuit when `backgroundType=embed-video`.
26. The PR MUST NOT introduce new global Block Bindings APIs beyond a reused filter (`block_bindings_attribute_replaced_in_markup` if Approach B is taken). Any new filter introduced MUST be carry weight against a cover-specific render path during the design phase.

### G. Tests

27. A new e2e test MUST cover: creating a Cover, binding its `url`+`id` to a Pattern Overrides source, asserting the editor and rendered front-end show the pattern default.
28. The same e2e test MUST cover: overriding the value on a pattern instance, asserting the rendered output reflects the override.
29. The same e2e test MUST cover: resetting the override, asserting the rendered output returns to the pattern default.
30. The e2e test MUST assert that the parallax toggle, repeat toggle, media-replace control (where lockable), and featured-image toggle are NOT in the DOM (or are NOT enabled) when a binding is active on the Cover instance.
31. The PHP test suite SHOULD include a `phpunit` test asserting that `render_block_core_cover` substitutes the bound `url` into the rendered `<img src>` and that the dimRatio class is rewritten when the saved value is the default 100.
32. Existing Cover tests (`packages/block-library/src/cover/test/edit.js`) MUST continue to pass.

### H. Project metadata / PR shape

33. The new file MUST live under `lib/compat/wordpress-7.1/block-bindings.php` (NOT 7.0). A `backport-changelog/7.1/<core-pr-number>.md` entry MUST be added when the corresponding Core PR is opened.
34. The PR description MUST link issue #77199 and explicitly call out whether it subsumes #74109 and #74610.
35. The net diff (including tests) SHOULD target under ~500 lines per prompt Acceptance Criteria.
36. The PR MUST be portable: the implementation MUST gracefully degrade on a WP install that does not yet have any of the bindings infrastructure changes (the existing `! function_exists` / version-guard pattern in the 6.9 compat file is the precedent).

### I. Explicitly out of scope (for traceability)

37. Binding `url` to an arbitrary external URL with no `id` is OUT OF SCOPE. (Q5)
38. Parallax + bindings combined behaviour beyond "force off" is OUT OF SCOPE. No CSS-in-style HTML rewriting. (Q4)
39. Featured-image-as-binding (using bindings to express the use-featured-image behaviour) is OUT OF SCOPE — separate follow-up. (Q9)
40. `backgroundType: "embed-video"` × bindings beyond non-regression is OUT OF SCOPE. (Q15)
41. New global Block Bindings APIs beyond at most one reused filter are OUT OF SCOPE.
42. Post-data source acquiring a `featured_media.url` / `featured_media.id` field (the "follow-up" from #74610 description) is OUT OF SCOPE.
