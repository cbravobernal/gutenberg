<?php
/**
 * Server-side rendering of the `core/post-comment-avatar` block.
 *
 * @package WordPress
 */

/**
 * Registers the `core/post-comment-avatar` block on the server.
 * We need to do this to make context available for inner blocks.
 */
function register_block_core_post_comment_avatar() {
	register_block_type_from_metadata(
		__DIR__ . '/post-comment-avatar'
	);
}
add_action( 'init', 'register_block_core_post_comment_avatar' );
