const MAX_PHOTOS = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function normalizarFotosProducto(value) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed == null) return [];
    if (!Array.isArray(parsed)) throw new Error('El formato de las fotos del producto no es válido.');
    if (parsed.length > MAX_PHOTOS) {
        throw new Error(`El producto supera el límite de ${MAX_PHOTOS} fotos.`);
    }

    return parsed.map(photo => {
        if (!photo || typeof photo.image !== 'string' || !photo.image.trim()) {
            throw new Error('Una de las fotos guardadas del producto no tiene una imagen válida.');
        }
        return {
            image: photo.image,
            color: typeof photo.color === 'string' ? photo.color : ''
        };
    });
}

function leerArchivoComoDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => {
            if (typeof reader.result !== 'string') {
                reject(new Error(`No se pudo leer el archivo "${file.name}".`));
                return;
            }
            resolve(reader.result);
        });
        reader.addEventListener('error', () => reject(new Error(`No se pudo leer el archivo "${file.name}".`)));
        reader.readAsDataURL(file);
    });
}

export function crearGestorFotosProducto({ input, contenedor, onError = () => {} }) {
    let photos = [];
    let colors = [];

    function render() {
        contenedor.replaceChildren();
        contenedor.hidden = photos.length === 0;

        photos.forEach((photo, index) => {
            const card = document.createElement('div');
            card.className = 'product-photo-card';

            const preview = document.createElement('img');
            preview.src = photo.image;
            preview.alt = `Foto ${index + 1} del producto`;

            const select = document.createElement('select');
            select.className = 'product-photo-color';
            select.setAttribute('aria-label', `Tipo de paquete de la foto ${index + 1}`);
            select.add(new Option('Seleccioná un tipo', ''));
            colors.forEach(color => select.add(new Option(color, color)));
            select.value = colors.includes(photo.color) ? photo.color : '';
            select.addEventListener('change', () => {
                photos[index].color = select.value;
            });

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'product-photo-remove';
            remove.textContent = 'Quitar';
            remove.setAttribute('aria-label', `Quitar foto ${index + 1}`);
            remove.addEventListener('click', () => {
                photos.splice(index, 1);
                render();
            });

            card.append(preview, select, remove);
            contenedor.appendChild(card);
        });
    }

    input.addEventListener('change', async () => {
        const files = Array.from(input.files || []);
        if (!files.length) return;

        try {
            if (photos.length + files.length > MAX_PHOTOS) {
                throw new Error(`Podés cargar hasta ${MAX_PHOTOS} fotos por producto.`);
            }
            const invalidFile = files.find(file => !ALLOWED_TYPES.has(file.type) || file.size > MAX_FILE_SIZE);
            if (invalidFile) {
                throw new Error(`"${invalidFile.name}" debe ser JPG, PNG o WebP y no superar los 5 MB.`);
            }

            const newPhotos = await Promise.all(files.map(async file => ({
                image: await leerArchivoComoDataUrl(file),
                color: ''
            })));
            photos.push(...newPhotos);
            render();
        } catch (error) {
            onError(error.message);
        } finally {
            input.value = '';
        }
    });

    render();

    return {
        getPhotos: () => photos.map(photo => ({ ...photo })),
        setColors(nextColors) {
            colors = [...new Set(nextColors.map(color => String(color || '').trim()).filter(Boolean))];
            render();
        },
        setPhotos(nextPhotos) {
            photos = normalizarFotosProducto(nextPhotos);
            render();
        }
    };
}
