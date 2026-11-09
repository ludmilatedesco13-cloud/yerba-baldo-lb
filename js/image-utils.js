export const DEFAULT_IMAGE = 'img/yerba-baldo.jpg';

export function setProductImage(imageElement, ...sources) {
    if (!imageElement) return;

    imageElement.onerror = () => {
        imageElement.onerror = null;
        imageElement.src = DEFAULT_IMAGE;
    };
    imageElement.src = sources.find(source => typeof source === 'string' && source.trim()) || DEFAULT_IMAGE;
}
