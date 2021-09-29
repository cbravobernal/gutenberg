/**
 * WordPress dependencies
 */
import { useBlockProps } from '@wordpress/block-editor';

export default function save( { attributes } ) {
	const { url, alt, width, height, id, title } = attributes;
	return (
		<img
			{ ...useBlockProps.save() }
			src={ url }
			alt={ alt }
			className={ id ? `wp-post-comment-avatar-${ id }` : null }
			width={ width }
			height={ height }
			title={ title }
		/>
	);
}
