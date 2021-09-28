/**
 * External dependencies
 */
import classnames from 'classnames';

/**
 * WordPress dependencies
 */
import {
	InspectorControls,
	__experimentalUseBorderProps as useBorderProps,
	__experimentalImageSizeControl as ImageSizeControl,
	useBlockProps,
} from '@wordpress/block-editor';
import { PanelBody, ResizableBox } from '@wordpress/components';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { __, isRTL } from '@wordpress/i18n';

export default ( { attributes, context, setAttributes } ) => {
	const { className, style, height, width } = attributes;
	const { commentId } = context;

	// Maximum provided by the WordPress site.
	const maxImageWidth = 96;
	const maxImageHeight = 96;
	if ( ! height || ! width ) {
		setAttributes( {
			height: maxImageHeight,
			width: maxImageWidth,
		} );
	}

	const displayAvatar = useSelect( ( select ) => {
		const { getEntityRecord } = select( coreStore );
		const comment = getEntityRecord( 'root', 'comment', commentId );
		const authorAvatarUrls = comment?.author_avatar_urls; // eslint-disable-line camelcase
		const borderProps = useBorderProps( attributes );

		if ( authorAvatarUrls ) {
			const avatarUrls = Object.values( authorAvatarUrls );
			const biggestAvatarUrl = avatarUrls[ 2 ];
			return (
				<ResizableBox
					size={ {
						width: width || maxImageWidth,
						height: height || maxImageHeight,
					} }
					onResizeStop={ ( event, direction, elt, delta ) => {
						setAttributes( {
							height: parseInt( height + delta.height, 10 ),
							width: parseInt( width + delta.width, 10 ),
						} );
					} }
					lockAspectRatio
					enable={ {
						top: false,
						right: isRTL() ? false : true,
						bottom: true,
						left: isRTL() ? true : false,
					} }
				>
					<img
						className={ classnames(
							className,
							borderProps.className,
							{
								// For backwards compatibility add style that isn't
								// provided via block support.
								'no-border-radius': style?.border?.radius === 0,
							}
						) }
						style={ {
							...borderProps.style,
						} }
						src={ biggestAvatarUrl }
						alt={ __( 'Post Comment Avatar Image' ) }
					/>
				</ResizableBox>
			);
		}
	} );
	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Comment Avatar Settings' ) }>
					<ImageSizeControl
						onChange={ ( value ) => setAttributes( value ) }
						width={ width }
						height={ height }
						imageWidth={ maxImageWidth }
						imageHeight={ maxImageHeight }
					/>
				</PanelBody>
			</InspectorControls>
			<div { ...useBlockProps() }>{ displayAvatar }</div>
		</>
	);
};
