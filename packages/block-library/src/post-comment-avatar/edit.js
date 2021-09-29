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
import { useEffect, useState } from '@wordpress/element';

export default ( { attributes, context: { commentId }, setAttributes } ) => {
	const { className, style, height, width, alt, url } = attributes;

	const { comment } = useSelect(
		( select ) => {
			const { getEntityRecord } = select( coreStore );
			return {
				comment: getEntityRecord( 'root', 'comment', commentId ),
			};
		},
		[ commentId ]
	);
	const borderProps = useBorderProps( attributes );
	const authorAvatarUrls = comment?.author_avatar_urls; // eslint-disable-line camelcase
	const avatarUrls = authorAvatarUrls
		? Object.values( authorAvatarUrls )
		: null;
	const [ { defaultWidth, defaultHeight }, setDefaultSize ] = useState( {} );

	// Set default widht, height and url on first render.
	useEffect( () => {
		setDefaultSize( { defaultWidth: width, defaultHeight: height } );
	}, [] );

	useEffect( () => {
		setAttributes( {
			url: avatarUrls ? avatarUrls[ avatarUrls.length - 1 ] : '', // we get the biggest resolution one
		} );
	}, [ avatarUrls ] );
	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Comment Avatar Settings' ) }>
					<ImageSizeControl
						onChange={ ( value ) => setAttributes( value ) }
						width={ width }
						height={ height }
						imageWidth={ defaultWidth }
						imageHeight={ defaultHeight }
						showPresets={ false }
					/>
				</PanelBody>
			</InspectorControls>
			<div { ...useBlockProps() }>
				{ avatarUrls ? (
					<ResizableBox
						size={ {
							width,
							height,
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
									'no-border-radius':
										style?.border?.radius === 0,
								}
							) }
							style={ {
								...borderProps.style,
							} }
							src={ url }
							alt={ alt }
						/>
					</ResizableBox>
				) : null }
			</div>
		</>
	);
};
