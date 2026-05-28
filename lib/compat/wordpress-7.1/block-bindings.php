<?php
/**
 * Block Bindings: Cover block support.
 *
 * Adds `id` and `url` to the server-side supported-attributes list for
 * `core/cover`, so the editor's `__experimentalBlockBindingsSupportedAttributes`
 * setting includes them and the Block Bindings panel exposes the corresponding
 * rows for binding. The matching client-side schema metadata (the `role: "content"`
 * marker on `core/cover`'s `id` attribute) is set in `block.json`.
 *
 * @since 7.1.0
 * @package gutenberg
 * @subpackage Block Bindings
 */

if ( ! function_exists( 'gutenberg_cover_bindings_add_supported_attributes' ) ) {
	/**
	 * Adds the `id` and `url` attributes to the list of supported block-bindings
	 * attributes for `core/cover`.
	 *
	 * Registered on the `block_bindings_supported_attributes` filter. For any
	 * block type other than `core/cover`, the input array is returned unchanged.
	 * Existing entries are preserved; `id` and `url` are appended only when not
	 * already present, so applying the filter twice on the same input remains
	 * stable (`[ 'id', 'url' ]`, never `[ 'id', 'url', 'id', 'url' ]`).
	 *
	 * @since 7.1.0
	 *
	 * @param string[] $attributes The list of attributes supported by Block Bindings
	 *                             for `$block_type`.
	 * @param string   $block_type The block type whose supported attributes are
	 *                             being filtered.
	 * @return string[] The (possibly augmented) list of supported attributes.
	 */
	function gutenberg_cover_bindings_add_supported_attributes( $attributes, $block_type ) {
		if ( 'core/cover' !== $block_type ) {
			return $attributes;
		}

		if ( ! in_array( 'id', $attributes, true ) ) {
			$attributes[] = 'id';
		}
		if ( ! in_array( 'url', $attributes, true ) ) {
			$attributes[] = 'url';
		}

		return $attributes;
	}
}

add_filter( 'block_bindings_supported_attributes', 'gutenberg_cover_bindings_add_supported_attributes', 10, 2 );

if ( ! function_exists( 'gutenberg_cover_bindings_expand_bindings' ) ) {
	/**
	 * Expands a Cover block's `metadata.bindings` array by materialising any
	 * `__default` entry into per-attribute slots.
	 *
	 * Mirrors the client-side `replacePatternOverridesDefaultBinding` helper at
	 * `packages/block-editor/src/utils/block-bindings.js` and the server-side
	 * expansion in `lib/compat/wordpress-6.9/block-bindings.php` (the
	 * `__default` branch inside `gutenberg_process_block_bindings`), scoped to
	 * the Cover-supported attribute list `[ 'id', 'url' ]`. Like both of those
	 * callers, expansion is only performed when `__default.source` is
	 * `core/pattern-overrides` — `__default` is currently a Pattern Overrides
	 * affordance and does not apply to other sources.
	 *
	 * When expansion runs, each Cover-supported attribute that does NOT already
	 * have an explicit binding entry inherits a `{ source: 'core/pattern-overrides' }`
	 * stub. Pre-existing explicit entries (e.g. a mixed-source configuration)
	 * are retained verbatim. The `__default` key itself is dropped from the
	 * returned array, matching the canonical expansion semantics.
	 *
	 * When `__default` is absent (or its source is not `core/pattern-overrides`),
	 * the input array is returned unchanged.
	 *
	 * @since 7.1.0
	 * @access private
	 *
	 * @param array<string, array<string, mixed>> $bindings The `metadata.bindings`
	 *                                                       map for a Cover block.
	 * @return array<string, array<string, mixed>> The expanded bindings map.
	 */
	function gutenberg_cover_bindings_expand_bindings( array $bindings ): array {
		if (
			! isset( $bindings['__default']['source'] ) ||
			'core/pattern-overrides' !== $bindings['__default']['source']
		) {
			return $bindings;
		}

		$expanded = array();
		foreach ( array( 'id', 'url' ) as $attribute_name ) {
			$expanded[ $attribute_name ] = isset( $bindings[ $attribute_name ] )
				? $bindings[ $attribute_name ]
				: array( 'source' => 'core/pattern-overrides' );
		}

		return $expanded;
	}
}

if ( ! function_exists( 'gutenberg_cover_bindings_is_active' ) ) {
	/**
	 * Determines whether a parsed Cover block has an active binding.
	 *
	 * Server-side mirror of the client `bindingActive` predicate computed in
	 * `useCoverBindingState`. A binding is "active" when, after `__default`
	 * expansion, BOTH the `id` and `url` attributes are bound to the same
	 * source instance — same `source` string AND `==`-equal `args`. Loose
	 * equality (`==`) on `args` matches the JS-side `JSON.stringify` parity
	 * check and is the correct semantic for the small associative bags that
	 * source `args` contain in practice; element ordering does not affect
	 * equality.
	 *
	 * The helper is intentionally pure-by-bindings: it does NOT short-circuit
	 * on `backgroundType === 'embed-video'` — that gate is the responsibility
	 * of the callers (the `render_block_data` and `render_block` filters that
	 * use this helper).
	 *
	 * @since 7.1.0
	 *
	 * @param array<string, mixed> $attrs The Cover block's attribute array
	 *                                    (typically `$parsed_block['attrs']`
	 *                                    or `$instance->attributes`).
	 * @return bool True when the Cover has an active `id`+`url` binding to the
	 *              same source instance; false otherwise (including the empty
	 *              and missing-bindings cases).
	 */
	function gutenberg_cover_bindings_is_active( array $attrs ): bool {
		$bindings = $attrs['metadata']['bindings'] ?? null;
		if ( empty( $bindings ) || ! is_array( $bindings ) ) {
			return false;
		}

		$expanded = gutenberg_cover_bindings_expand_bindings( $bindings );

		$same_source = ( $expanded['id']['source'] ?? null ) === ( $expanded['url']['source'] ?? null );
		// Loose equality on associative arrays per Design §6.1 — `args` are a
		// small bag of scalars and we want order-insensitive comparison.
		$same_args = ( $expanded['id']['args'] ?? null ) == ( $expanded['url']['args'] ?? null ); // phpcs:ignore WordPress.PHP.StrictComparisons.LooseComparison

		return ! empty( $expanded['id'] ) && ! empty( $expanded['url'] ) && $same_source && $same_args;
	}
}

if ( ! function_exists( 'gutenberg_cover_bindings_prepare_block' ) ) {
	/**
	 * Neutralises `useFeaturedImage` on Cover blocks whose `id`+`url` bindings
	 * are active, before `WP_Block::render()` builds its instance attributes.
	 *
	 * Registered on the `render_block_data` filter, which fires inside
	 * `render_block()` (see `wp-includes/blocks.php`) BEFORE `WP_Block` is
	 * constructed for the parsed block. By forcing
	 * `$parsed_block['attrs']['useFeaturedImage']` to `false` here when a
	 * Cover-scoped binding is active, `render_block_core_cover` skips its
	 * featured-image injection branch on the first render pass. This is the
	 * AC-18 precedence rule: an active `id`+`url` binding always wins over
	 * `useFeaturedImage`, with no double-`<img>` window.
	 *
	 * Gating order (each step short-circuits to "return unchanged"):
	 *
	 * 1. The block is not `core/cover`.
	 * 2. `backgroundType === 'embed-video'` — embed-video covers are explicitly
	 *    out of scope for the Cover-scoped binding path (AC-21); their existing
	 *    `useFeaturedImage` semantics remain untouched.
	 * 3. The bindings are not active per `gutenberg_cover_bindings_is_active()`
	 *    (no `metadata.bindings`, mismatched source, or differing `args`).
	 *
	 * Only after all three gates pass — AND `useFeaturedImage` is currently
	 * truthy — does the mutation run. When `useFeaturedImage` is already
	 * falsy/absent, the array is returned unchanged.
	 *
	 * Persistence safety: the mutation is scoped to the in-flight
	 * `$parsed_block` array used for this render pass only. PHP arrays are
	 * value-copied on assignment, so the caller's array is not modified, and
	 * the persisted `post_content` is never touched.
	 *
	 * @since 7.1.0
	 *
	 * @param array              $parsed_block The parsed block array, including
	 *                                         `blockName` and `attrs` keys.
	 * @param array              $source_block The original block as parsed (passed
	 *                                         through unchanged).
	 * @param WP_Block|null      $parent_block The parent block, if any (unused).
	 * @return array The (possibly mutated) parsed block array.
	 */
	function gutenberg_cover_bindings_prepare_block( $parsed_block, $source_block, $parent_block ) {
		if ( 'core/cover' !== ( $parsed_block['blockName'] ?? '' ) ) {
			return $parsed_block;
		}

		$attrs = $parsed_block['attrs'] ?? array();

		// AC-21: never engage for embed-video covers.
		if ( ! empty( $attrs['backgroundType'] ) && 'embed-video' === $attrs['backgroundType'] ) {
			return $parsed_block;
		}

		if ( ! gutenberg_cover_bindings_is_active( $attrs ) ) {
			return $parsed_block;
		}

		// AC-18: an active binding wins over useFeaturedImage. Only mutate when
		// there is something to flip, so the array is touched as little as
		// possible.
		if ( ! empty( $attrs['useFeaturedImage'] ) ) {
			$parsed_block['attrs']['useFeaturedImage'] = false;
		}

		return $parsed_block;
	}
}

add_filter( 'render_block_data', 'gutenberg_cover_bindings_prepare_block', 10, 3 );
