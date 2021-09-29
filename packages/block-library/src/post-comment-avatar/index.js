/**
 * Internal dependencies
 */
import metadata from './block.json';
import edit from './edit';
import save from './save';

/**
 * WordPress dependencies
 */
import { postCommentsAvatar as icon } from '@wordpress/icons';

const { name } = metadata;
export { metadata, name };

export const settings = {
	icon,
	edit,
	save,
};
