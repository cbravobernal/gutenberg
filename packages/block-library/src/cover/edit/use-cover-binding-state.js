/**
 * Client-side binding state for Cover. Mirrors `core/image`'s url-only
 * precedent: the binding is "active" whenever `url` is bound (the framework
 * resolves it into `attributes.url` before render). An optional `id` binding
 * just enables attachment-metadata reuse server-side.
 *
 * @param {Object} options            Hook options.
 * @param {Object} options.attributes The Cover block's attributes (already
 *                                    binding-resolved by the framework).
 * @return {{ bindingActive: boolean, bindingResolvedUrl: (string|undefined) }} Binding state.
 */
export default function useCoverBindingState( { attributes } ) {
	const bindings = attributes.metadata?.bindings;
	const hasUrlBinding = !! bindings?.__default || !! bindings?.url;

	const bindingActive =
		hasUrlBinding && attributes.backgroundType !== 'embed-video';

	return {
		bindingActive,
		bindingResolvedUrl: bindingActive ? attributes.url : undefined,
	};
}
