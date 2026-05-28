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
