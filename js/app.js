import { DEFAULT_IMAGE, setProductImage } from './image-utils.js';
import { crearGestorFotosProducto } from './product-photos.js';
const role = (localStorage.getItem('rol') || '').toLowerCase();
let productos = [];
let variantesPorProducto = new Map();
let carritoVenta = [];
let subcategoriasPorCategoria = {}; 
let metodosPagoDisponibles = [];
let ventasParaReporte = [];
let detallesParaReporte = [];
let stockGeneralActual = 0;
let ventasResumen = [];
let productosSinStockActual = 0;
let requestResumenId = 0;
let tipoFechaVentaCache = null;
let gestorFotosProducto = null;

const money = value => Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const parsePrice = value => { const text = String(value ?? '').trim().replace(/\s/g, ''); if (!text) return NaN; if (text.includes(',')) return Number(text.replace(/\./g, '').replace(',', '.')); const parts = text.split('.'); return parts.length > 1 && parts.at(-1).length === 3 ? Number(parts.join('')) : Number(text); };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const showError = message => Swal.fire({ icon: 'error', title: 'Atención', text: message, confirmButtonColor: '#5c723f' });
const showSuccess = (title, text) => Swal.fire({ icon: 'success', title, text, confirmButtonColor: '#5c723f' });

async function obtenerTipoFechaVenta() {
    if (tipoFechaVentaCache) return tipoFechaVentaCache;
    const columnas = await executeNeonQuery(`
        SELECT data_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
            AND table_name = 'ventas'
            AND column_name = 'fecha'
        LIMIT 1
    `);
    tipoFechaVentaCache = columnas[0]?.data_type;
    if (!['date', 'timestamp without time zone', 'timestamp with time zone'].includes(tipoFechaVentaCache)) {
        throw new Error('No se pudo identificar el tipo de la columna ventas.fecha en la base de datos.');
    }
    return tipoFechaVentaCache;
}

async function consultarVentasConFechaLocal() {
    const tipoFecha = await obtenerTipoFechaVenta();
    let fechaLocalSql;
    if (tipoFecha === 'date') {
        fechaLocalSql = `CASE
            WHEN fecha = CURRENT_DATE
                AND CURRENT_DATE > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
            THEN (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text
            ELSE fecha::text
        END`;
    } else if (tipoFecha === 'timestamp without time zone') {
        fechaLocalSql = "(fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text";
    } else {
        fechaLocalSql = "(fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text";
    }
    return executeNeonQuery(`SELECT id, ${fechaLocalSql} AS fecha, total FROM ventas ORDER BY fecha DESC`);
}

// --- GESTIÓN DE MÉTODOS DE PAGO ---
const opcionesMetodoPago = [
    {
        nombre: 'Efectivo',
        icono: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="12" width="31" height="22" rx="3"></rect><path d="M10 17c2 0 3-1 3-3m18 3c-2 0-3-1-3-3M10 29c2 0 3 1 3 3m18-3c-2 0-3 1-3 3"></path><circle cx="20.5" cy="23" r="5"></circle><circle cx="38" cy="34" r="6"></circle><path d="M38 31v6m-2-4h4"></path></svg>'
    },
    {
        nombre: 'Tarjeta de Débito',
        icono: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="10" width="38" height="28" rx="5"></rect><path d="M5 18h38M12 29h9m-9 4h5"></path><path d="m31 27 3 3 6-7"></path></svg>'
    },
    {
        nombre: 'Tarjeta de Crédito',
        icono: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="10" width="38" height="28" rx="5"></rect><path d="M5 18h38M12 25h10v8H12z"></path><path d="M15 25v8m4-8v8m-7-4h10"></path></svg>'
    },
    {
        nombre: 'Transferencia',
        icono: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m7 18 17-11 17 11H7Z"></path><path d="M11 20v13m9-13v13m9-13v13m9-13v13M7 36h34M5 41h38"></path><path d="M12 27h7m-3-3 3 3-3 3m22-9h-7m3-3-3 3 3 3"></path></svg>'
    }
];

function normalizarNombreMetodoPago(nombre) {
    return String(nombre || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLocaleLowerCase('es-AR');
}

function renderMetodosPago() {
    const inputMetodo = document.getElementById('metodo_pago');
    const opciones = document.getElementById('payment-method-options');
    if (inputMetodo && opciones) {
        const metodoSeleccionado = inputMetodo.value;
        opciones.innerHTML = opcionesMetodoPago.map(opcion => {
            const metodo = metodosPagoDisponibles.find(item =>
                normalizarNombreMetodoPago(item.nombre) === normalizarNombreMetodoPago(opcion.nombre)
            );
            const porcentaje = Number(metodo?.valor_ajuste || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
            let detalle = 'Sin recargo ni descuento';
            if (metodo?.tipo_ajuste === 'descuento') detalle = `${porcentaje}% de descuento`;
            if (metodo?.tipo_ajuste === 'recargo') detalle = `${porcentaje}% de recargo`;

            return `<button type="button" class="payment-method-card"
                data-method-name="${escapeHtml(metodo?.nombre || '')}"
                aria-pressed="${Boolean(metodo && metodo.nombre === metodoSeleccionado)}"
                ${metodo ? '' : 'disabled'}>
                <span class="payment-method-icon">${opcion.icono}</span>
                <span class="payment-method-name">${escapeHtml(opcion.nombre)}</span>
                <span class="payment-method-adjustment">${metodo ? detalle : 'No disponible'}</span>
            </button>`;
        }).join('');
    }

    const selectConfig = document.getElementById('metodo_pago_config');
    if (selectConfig) {
        const metodoConfigSeleccionado = selectConfig.value;
        selectConfig.replaceChildren(new Option('-- Seleccioná un método --', ''));
        metodosPagoDisponibles.forEach(metodo => {
            selectConfig.add(new Option(metodo.nombre, metodo.id));
        });
        selectConfig.value = metodosPagoDisponibles.some(metodo => String(metodo.id) === metodoConfigSeleccionado)
            ? metodoConfigSeleccionado
            : String(metodosPagoDisponibles[0]?.id || '');
        cargarConfiguracionMetodoPago();
    }
}

async function cargarMetodosPago() {
    try {
        await executeNeonQuery(
            `INSERT INTO metodos_pago (nombre, tipo_ajuste, valor_ajuste)
            SELECT metodo.nombre, NULL, 0
            FROM (VALUES ('Efectivo'), ('Tarjeta de Débito'), ('Tarjeta de Crédito'), ('Transferencia')) AS metodo(nombre)
            WHERE NOT EXISTS (
                SELECT 1
                FROM metodos_pago existente
                WHERE LOWER(TRIM(existente.nombre)) = LOWER(metodo.nombre)
            )`
        );
        const metodos = await executeNeonQuery('SELECT * FROM metodos_pago ORDER BY id');
        metodosPagoDisponibles = metodos || [];
        renderMetodosPago();
    } catch (error) {
        console.error('Error cargando métodos de pago:', error);
        showError('No se pudieron cargar los métodos de pago: ' + error.message);
    }
}

function cargarConfiguracionMetodoPago() {
    const selectMetodo = document.getElementById('metodo_pago_config');
    const selectTipo = document.getElementById('tipo_ajuste_config');
    const inputPorcentaje = document.getElementById('valor_ajuste_config');
    if (!selectMetodo || !selectTipo || !inputPorcentaje) return;

    const metodo = metodosPagoDisponibles.find(item => String(item.id) === selectMetodo.value);
    selectTipo.value = metodo?.tipo_ajuste || '';
    inputPorcentaje.value = metodo?.valor_ajuste ?? 0;
    actualizarCampoPorcentaje();
}

function actualizarCampoPorcentaje() {
    const selectTipo = document.getElementById('tipo_ajuste_config');
    const inputPorcentaje = document.getElementById('valor_ajuste_config');
    if (!selectTipo || !inputPorcentaje) return;

    inputPorcentaje.disabled = !selectTipo.value;
    inputPorcentaje.required = Boolean(selectTipo.value);
    if (selectTipo.value === 'descuento') inputPorcentaje.max = '100';
    else inputPorcentaje.removeAttribute('max');
}

async function guardarConfiguracionMetodoPago(event) {
    event.preventDefault();
    const selectMetodo = document.getElementById('metodo_pago_config');
    const selectTipo = document.getElementById('tipo_ajuste_config');
    const inputPorcentaje = document.getElementById('valor_ajuste_config');
    const metodo = metodosPagoDisponibles.find(item => String(item.id) === selectMetodo.value);
    if (!metodo) return showError('Seleccioná un método de pago.');

    const tipoAjuste = selectTipo.value || null;
    const porcentaje = tipoAjuste ? Number(inputPorcentaje.value) : 0;
    if (tipoAjuste && (!Number.isFinite(porcentaje) || porcentaje < 0)) {
        return showError('Ingresá un porcentaje válido, igual o mayor a cero.');
    }
    if (tipoAjuste === 'descuento' && porcentaje > 100) {
        return showError('El descuento no puede superar el 100%.');
    }

    try {
        await executeNeonQuery(
            'UPDATE metodos_pago SET tipo_ajuste = $1, valor_ajuste = $2 WHERE id = $3',
            [tipoAjuste, porcentaje, metodo.id]
        );
        metodo.tipo_ajuste = tipoAjuste;
        metodo.valor_ajuste = porcentaje;
        renderMetodosPago();
        recalcularTotalVenta();
        showSuccess('Configuración guardada', `Se actualizó "${metodo.nombre}".`);
    } catch (error) {
        showError('No se pudo guardar la configuración: ' + error.message);
    }
}

// --- GESTIÓN DINÁMICA DE CATEGORÍAS Y SUBCATEGORÍAS ---
async function cargarCategoriasYSubcategorias() {
    try {
        const [resCat, resSub] = await Promise.all([
            executeNeonQuery('SELECT * FROM categorias ORDER BY nombre'),
            executeNeonQuery('SELECT * FROM subcategorias ORDER BY nombre')
        ]);

        const selectCategoria = document.getElementById('categoria');
        if (!selectCategoria) return;
        const categoriaActual = selectCategoria.value;

        selectCategoria.innerHTML = '<option value="">-- Seleccionar Categoría --</option>';
        subcategoriasPorCategoria = {};

        (resCat || []).forEach(cat => {
            selectCategoria.add(new Option(cat.nombre, cat.nombre));
            subcategoriasPorCategoria[cat.nombre] = [];
        });

        (resSub || []).forEach(sub => {
            const catRelacionada = resCat.find(c => c.id === sub.categoria_id)?.nombre;
            if (catRelacionada && subcategoriasPorCategoria[catRelacionada]) {
                subcategoriasPorCategoria[catRelacionada].push(sub.nombre);
            }
        });

        if (categoriaActual) {
            selectCategoria.value = categoriaActual;
            actualizarSubcategorias();
        }
    } catch (error) {
        console.error('Error cargando clasificaciones:', error);
    }
}

function actualizarSubcategorias() { 
    const selectSub = document.getElementById('subcategoria');
    const selectCat = document.getElementById('categoria');
    if (!selectSub || !selectCat) return;

    const catSeleccionada = selectCat.value;
    const subActual = selectSub.value;

    selectSub.innerHTML = '<option value="">-- Seleccionar Subcategoría --</option>'; 
    
    const subs = subcategoriasPorCategoria[catSeleccionada] || [];
    subs.forEach(value => selectSub.add(new Option(value, value)));

    if (subs.includes(subActual)) {
        selectSub.value = subActual;
    }
}

async function agregarNuevaCategoria() {
    const { value: nuevaCat } = await Swal.fire({
        title: 'Nueva Categoría',
        input: 'text',
        inputPlaceholder: 'Ej: Yerba Mate, Accesorios...',
        showCancelButton: true,
        confirmButtonColor: '#5c723f',
        cancelButtonColor: '#a95c42',
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        inputValidator: value => !value.trim() ? '¡Tenés que escribir un nombre!' : undefined
    });

    if (nuevaCat) {
        try {
            await executeNeonQuery('INSERT INTO categorias (nombre) VALUES ($1)', [nuevaCat.trim()]);
            await cargarCategoriasYSubcategorias();
            document.getElementById('categoria').value = nuevaCat.trim();
            actualizarSubcategorias();
            showSuccess('¡Creada!', 'La categoría fue agregada con éxito.');
        } catch (error) {
            showError('No se pudo guardar la categoría: ' + error.message);
        }
    }
}

async function agregarNuevaSubcategoria() {
    const catSeleccionada = document.getElementById('categoria').value;
    if (!catSeleccionada) return showError('Primero seleccioná una categoría para añadirle una subcategoría.');

    const { value: nuevaSub } = await Swal.fire({
        title: `Nueva Subcategoría para "${catSeleccionada}"`,
        input: 'text',
        inputPlaceholder: 'Nombre de la subcategoría...',
        showCancelButton: true,
        confirmButtonColor: '#5c723f',
        cancelButtonColor: '#a95c42',
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        inputValidator: value => !value.trim() ? '¡Tenés que escribir un nombre!' : undefined
    });

    if (nuevaSub) {
        try {
            const catData = await executeNeonQuery('SELECT id FROM categorias WHERE nombre = $1', [catSeleccionada]);
            if (!catData.length) throw new Error('Categoría no encontrada.');

            await executeNeonQuery('INSERT INTO subcategorias (categoria_id, nombre) VALUES ($1, $2)', [catData[0].id, nuevaSub.trim()]);
            await cargarCategoriasYSubcategorias();
            document.getElementById('categoria').value = catSeleccionada;
            actualizarSubcategorias();
            document.getElementById('subcategoria').value = nuevaSub.trim();
            showSuccess('¡Creada!', 'La subcategoría fue agregada con éxito.');
        } catch (error) {
            showError('No se pudo guardar la subcategoría: ' + error.message);
        }
    }
}

async function eliminarCategoriaSeleccionada() {
    const nombre = document.getElementById('categoria').value;
    if (!nombre) return showError('Primero seleccioná una categoría.');

    const confirmacion = await Swal.fire({
        title: '¿Eliminar categoría?',
        text: `Se eliminará "${nombre}". Esta acción no se puede deshacer.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#a95c42',
        cancelButtonColor: '#5c723f',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        reverseButtons: true
    });
    if (!confirmacion.isConfirmed) return;

    try {
        const cat = await executeNeonQuery('SELECT id FROM categorias WHERE nombre = $1', [nombre]);
        if (!cat.length) throw new Error('Categoría no encontrada.');

        const subs = await executeNeonQuery('SELECT id FROM subcategorias WHERE categoria_id = $1', [cat[0].id]);
        if (subs.length) return showError('No se puede eliminar: primero eliminá sus subcategorías.');

        const prods = await executeNeonQuery('SELECT id FROM productos WHERE categoria = $1 LIMIT 1', [nombre]);
        if (prods.length) return showError('No se puede eliminar: la categoría está siendo usada por un producto.');

        await executeNeonQuery('DELETE FROM categorias WHERE id = $1', [cat[0].id]);
        await cargarCategoriasYSubcategorias();
        document.getElementById('categoria').value = '';
        actualizarSubcategorias();
        showSuccess('¡Categoría eliminada!', 'La categoría fue eliminada correctamente.');
    } catch (error) {
        showError('No se pudo eliminar la categoría: ' + error.message);
    }
}

async function eliminarSubcategoriaSeleccionada() {
    const categoriaNombre = document.getElementById('categoria').value;
    const nombre = document.getElementById('subcategoria').value;
    if (!categoriaNombre || !nombre) return showError('Seleccioná una categoría y una subcategoría.');

    const confirmacion = await Swal.fire({
        title: '¿Eliminar subcategoría?',
        text: `Se eliminará "${nombre}". Esta acción no se puede deshacer.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#a95c42',
        cancelButtonColor: '#5c723f',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        reverseButtons: true
    });
    if (!confirmacion.isConfirmed) return;

    try {
        const cat = await executeNeonQuery('SELECT id FROM categorias WHERE nombre = $1', [categoriaNombre]);
        if (!cat.length) throw new Error('Categoría no encontrada.');

        const prods = await executeNeonQuery('SELECT id FROM productos WHERE categoria = $1 AND subcategoria = $2 LIMIT 1', [categoriaNombre, nombre]);
        if (prods.length) return showError('No se puede eliminar: la subcategoría está siendo usada por un producto.');

        await executeNeonQuery('DELETE FROM subcategorias WHERE categoria_id = $1 AND nombre = $2', [cat[0].id, nombre]);
        await cargarCategoriasYSubcategorias();
        document.getElementById('categoria').value = categoriaNombre;
        actualizarSubcategorias();
        showSuccess('¡Subcategoría eliminada!', 'La subcategoría fue eliminada correctamente.');
    } catch (error) {
        showError('No se pudo eliminar la subcategoría: ' + error.message);
    }
}

// --- ROL E INVENTARIO ---
function aplicarRol() { 
    const admin = role === 'admin'; 
    document.querySelectorAll('.admin-only').forEach(element => { element.hidden = !admin; }); 
    const usuarioElem = document.getElementById('nombre-usuario');
    if (usuarioElem) {
        usuarioElem.textContent = localStorage.getItem('usuario') || (admin ? 'Administrador' : 'Empleado'); 
    }
}

function renderDatalist() { 
    const list = document.getElementById('lista_productos'); 
    if (!list) return;
    list.innerHTML = ''; 
    productos.forEach(producto => {
        const variantes = variantesPorProducto.get(String(producto.id)) || [
            { articulo: String(producto.id), talle: producto.talle || '', color: producto.color || '', stock: Number(producto.stock || 0) }
        ];
        if (!variantes.some(variant => Number(variant.stock) > 0)) return;
        const label = `${producto.nombre}${producto.marca ? ` · ${producto.marca}` : ''} · Presentaciones disponibles`;
        const option = new Option(label);
        option.dataset.id = producto.id;
        list.appendChild(option);
    });
}

function agruparVariantes(variantes) {
    const agrupadas = new Map();
    (variantes || []).forEach(variant => {
        const talle = variant.talle || '';
        const color = variant.color || '';
        const key = `${talle}\u0000${color}`;
        const actual = agrupadas.get(key);
        if (actual) actual.stock += Number(variant.stock || 0);
        else agrupadas.set(key, { articulo: variant.articulo || '', talle, color, stock: Number(variant.stock || 0) });
    });
    return [...agrupadas.values()];
}

function renderInventario() { 
    const tablaInv = document.getElementById('tabla-inventario');
    if (!tablaInv) return;

    tablaInv.innerHTML = productos.length ? productos.map(p => `
        <tr>
            <td>${escapeHtml(p.id)}</td>
            <td><strong>${escapeHtml(p.nombre)}</strong></td>
            <td>${escapeHtml(p.marca || '-')}</td>
            <td>${escapeHtml([...new Set((variantesPorProducto.get(String(p.id)) || []).map(variant => variant.talle || '-'))].join(', ') || p.talle || '-')}</td>
            <td>${escapeHtml([...new Set((variantesPorProducto.get(String(p.id)) || []).map(variant => variant.color || '-'))].join(', ') || p.color || '-')}</td>
            <td><span class="badge-categoria">${escapeHtml(p.categoria || '-')}</span><span class="subcategoria-texto">${escapeHtml(p.subcategoria || '')}</span></td>
            <td>$${money(p.precio_venta)}</td>
            <td>${escapeHtml(p.stock)} u.</td>
            <td class="inventory-actions-cell" style="text-align:center;">
                <div class="inventory-actions" style="display:inline-flex; gap:6px;">
                <button type="button" class="btn-icon btn-ver" data-id="${escapeHtml(p.id)}" title="Ver Detalles">🔎</button>
                ${role === 'admin' ? `<button type="button" class="btn-icon btn-editar" data-id="${escapeHtml(p.id)}" title="Editar" style="color:#46572f;">✏️</button><button type="button" class="btn-icon btn-eliminar" data-id="${escapeHtml(p.id)}" title="Eliminar" style="color:#a95c42;">🗑️</button>` : ''}
                </div>
            </td>
        </tr>`).join('') : '<tr><td colspan="9" style="text-align:center;">No hay productos registrados.</td></tr>'; 
}

async function cargarProductos() { 
    await window.asegurarTablaVariantes();
    const [data, variantesIniciales] = await Promise.all([
        executeNeonQuery('SELECT * FROM productos ORDER BY id'),
        executeNeonQuery('SELECT * FROM producto_variantes ORDER BY producto_id, talle, color')
    ]);
    productos = data || []; 
    const productosConVariantes = new Set((variantesIniciales || []).map(variant => String(variant.producto_id)));
    for (const producto of productos) {
        if (!productosConVariantes.has(String(producto.id))) {
            await executeNeonQuery(
                'INSERT INTO producto_variantes (producto_id, articulo, talle, color, stock) VALUES ($1, $2, $3, $4, $5)',
                [producto.id, String(producto.id), producto.talle || '', producto.color || '', Number(producto.stock || 0)]
            );
        }
    }
    const variantes = await executeNeonQuery('SELECT * FROM producto_variantes ORDER BY producto_id, talle, color');
    variantesPorProducto = new Map();
    (variantes || []).forEach(variant => {
        const key = String(variant.producto_id);
        if (!variantesPorProducto.has(key)) variantesPorProducto.set(key, []);
        variantesPorProducto.get(key).push(variant);
    });
    variantesPorProducto.forEach((items, key) => variantesPorProducto.set(key, agruparVariantes(items)));
    renderInventario(); 
    renderDatalist(); 
}

async function cargarResumen() { 
    if (role !== 'admin') return; 
    const [ventas, stock, totalStock] = await Promise.all([
        consultarVentasConFechaLocal(),
        executeNeonQuery('SELECT id FROM productos WHERE stock = 0'),
        executeNeonQuery('SELECT COALESCE(SUM(stock), 0) AS total FROM productos')
    ]); 
    ventasResumen = ventas || [];
    productosSinStockActual = (stock || []).length;
    stockGeneralActual = Number(totalStock[0]?.total || 0);
    await actualizarMetricasResumen();
}

async function actualizarMetricasResumen() {
    const requestId = ++requestResumenId;
    const periodo = document.getElementById('resumen-periodo')?.value || 'month';
    const fechaReferencia = document.getElementById('resumen-fecha')?.value || formatearFechaLocal(new Date());
    const estado = document.getElementById('estado-resumen');
    const { start, end } = obtenerRangoReporte(periodo, fechaReferencia);
    const ventasPeriodo = ventasResumen.filter(venta => {
        const fecha = obtenerFechaVenta(venta.fecha);
        return fecha && fecha >= start && fecha < end;
    });
    const idsVentas = [...new Set(ventasPeriodo.map(venta => String(venta.id)))];

    if (estado) estado.textContent = 'Actualizando métricas…';

    try {
        const detalles = idsVentas.length
            ? await executeNeonQuery(`
                SELECT dv.venta_id, dv.cantidad, p.precio_costo
                FROM detalle_venta dv
                JOIN productos p ON p.id = dv.producto_id
                WHERE dv.venta_id::text IN (
                    SELECT venta_id
                    FROM jsonb_to_recordset($1::jsonb) AS ventas(venta_id TEXT)
                )
            `, [JSON.stringify(idsVentas.map(venta_id => ({ venta_id })))])
            : [];
        if (requestId !== requestResumenId) return;

        const totalRecaudado = ventasPeriodo.reduce((sum, venta) => sum + Number(venta.total || 0), 0);
        const costoProductos = detalles.reduce((sum, detalle) =>
            sum + Number(detalle.cantidad || 0) * Number(detalle.precio_costo || 0), 0);
        const unidadesVendidas = detalles.reduce((sum, detalle) => sum + Number(detalle.cantidad || 0), 0);

        const totalVentasElem = document.getElementById('total-ventas');
        const cajaTotalElem = document.getElementById('caja-total');
        const gananciaTotalElem = document.getElementById('ganancia-total');
        const unidadesElem = document.getElementById('unidades-vendidas');
        const productosSinStockElem = document.getElementById('productos-sin-stock');

        if (totalVentasElem) totalVentasElem.textContent = ventasPeriodo.length;
        if (cajaTotalElem) cajaTotalElem.textContent = `$${money(totalRecaudado)}`;
        if (gananciaTotalElem) gananciaTotalElem.textContent = `$${money(totalRecaudado - costoProductos)}`;
        if (unidadesElem) unidadesElem.textContent = unidadesVendidas;
        if (productosSinStockElem) productosSinStockElem.textContent = productosSinStockActual;
        if (estado) estado.textContent = '';
    } catch (error) {
        if (requestId !== requestResumenId) return;
        console.error('Error actualizando el resumen del negocio:', error);
        if (estado) estado.textContent = `No se pudieron actualizar las métricas: ${error.message}`;
    }
}

function actualizarColoresFotosProducto() {
    const colores = [...document.querySelectorAll('.variante-row .var-color')]
        .map(input => input.value.trim())
        .filter(Boolean);
    gestorFotosProducto?.setColors(colores);
}

// --- CARRITO Y VENTA ---
function actualizarTablaCarrito() { 
    const body = document.querySelector('#tabla-carrito tbody'); 
    if (!body) return;
    body.innerHTML = carritoVenta.length ? carritoVenta.map((item, i) => `
        <tr>
            <td><strong>${escapeHtml(item.nombre)}</strong></td>
            <td>${escapeHtml(item.talle || '-')}</td>
            <td>${escapeHtml(item.color || '-')}</td>
            <td>$${money(item.precio)}</td>
            <td>${item.cantidad}</td>
            <td>$${money(item.precio * item.cantidad)}</td>
            <td><button type="button" class="btn-icon quitar-item" data-index="${i}" style="color:#a95c42;">❌</button></td>
        </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;">El carrito está vacío.</td></tr>'; 
    
    recalcularTotalVenta();
}

function calcularTotalesVenta() {
    const subtotal = carritoVenta.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
    const inputMetodo = document.getElementById('metodo_pago');
    const metodoNombre = inputMetodo ? inputMetodo.value : '';
    const metodo = metodosPagoDisponibles.find(m => m.nombre === metodoNombre);
    
    let totalFinal = subtotal;
    let textoDetalle = '';

    if (metodo && subtotal > 0) {
        if (metodo.tipo_ajuste === 'descuento') {
            const descuento = subtotal * (Number(metodo.valor_ajuste) / 100);
            totalFinal = subtotal - descuento;
            textoDetalle = `Subtotal: $${money(subtotal)} | Descuento (${metodo.valor_ajuste}%): -$${money(descuento)}`;
        } else if (metodo.tipo_ajuste === 'recargo') {
            const recargo = subtotal * (Number(metodo.valor_ajuste) / 100);
            totalFinal = subtotal + recargo;
            textoDetalle = `Subtotal: $${money(subtotal)} | Recargo (${metodo.valor_ajuste}%): +$${money(recargo)}`;
        } else {
            textoDetalle = `Pago contado / sin recargos.`;
        }
    }

    const detalleCalc = document.getElementById('detalle-calculo-pago');
    if (detalleCalc) detalleCalc.textContent = textoDetalle;
    return { subtotal, totalFinal };
}

function recalcularTotalVenta() {
    const { totalFinal } = calcularTotalesVenta();
    const montoTotal = document.getElementById('monto-total-venta');
    if (montoTotal) montoTotal.textContent = money(totalFinal);
}

function agregarAlCarrito() { 
    const inputBusqueda = document.getElementById('producto_buscar');
    const inputCant = document.getElementById('cantidad');
    if (!inputBusqueda || !inputCant) return;

    const value = inputBusqueda.value.trim();
    const quantity = Number(inputCant.value);
    const option = Array.from(document.getElementById('lista_productos')?.options || [])
        .find(item => item.value === value);
    const product = option
        ? productos.find(item => String(item.id) === option.dataset.id)
        : null;
    if (!product || !Number.isInteger(quantity) || quantity <= 0) return showError('Seleccioná un producto válido y una cantidad mayor a 0.');
    seleccionarProductoVenta();
    const selectVariante = document.getElementById('variante-venta');
    const variantes = variantesPorProducto.get(String(product.id)) || [
        { articulo: String(product.id), talle: product.talle || '', color: product.color || '', stock: Number(product.stock || 0) }
    ];
    if (!selectVariante || selectVariante.value === '') {
        return showError('Seleccioná la presentación y tipo antes de añadir el producto.');
    }
    const variant = variantes[Number(selectVariante.value)];
    if (!variant) return showError('Seleccioná la presentación y tipo antes de añadir el producto.');
    const talle = variant.talle || '';
    const color = variant.color || '';

    const stockDisponible = Number(variant.stock);
    const articulo = variant.articulo || String(product.id);
    const existing = carritoVenta.find(item =>
        String(item.id) === String(product.id) && item.articulo === articulo && item.talle === talle && item.color === color
    );
    if (stockDisponible <= 0 || (existing?.cantidad || 0) + quantity > stockDisponible) return showError(`Stock insuficiente para presentación ${talle || 'S/P'} y tipo ${color || 'S/T'}. Disponibles: ${stockDisponible} u.`); 
    if (existing) existing.cantidad += quantity; 
    else carritoVenta.push({ id: product.id, nombre: product.nombre, articulo, talle, color, precio: Number(product.precio_venta), cantidad: quantity }); 
    inputBusqueda.value = '';
    document.getElementById('selector-variante-venta').hidden = true;
    selectVariante.replaceChildren(new Option('Primero seleccioná un producto', ''));
    actualizarTablaCarrito(); 
}

function seleccionarProductoVenta() {
    const inputBusqueda = document.getElementById('producto_buscar');
    const selector = document.getElementById('selector-variante-venta');
    const selectVariante = document.getElementById('variante-venta');
    if (!inputBusqueda || !selector || !selectVariante) return;

    const option = Array.from(document.getElementById('lista_productos')?.options || [])
        .find(item => item.value === inputBusqueda.value.trim());
    const product = option
        ? productos.find(item => String(item.id) === option.dataset.id)
        : null;
    if (!product) {
        selector.hidden = true;
        delete selector.dataset.productId;
        selectVariante.replaceChildren(new Option('Primero seleccioná un producto', ''));
        return;
    }
    if (selector.dataset.productId === String(product.id) && !selector.hidden) return;

    const variantes = variantesPorProducto.get(String(product.id)) || [
        { articulo: String(product.id), talle: product.talle || '', color: product.color || '', stock: Number(product.stock || 0) }
    ];
    selectVariante.replaceChildren(new Option('Seleccioná presentación y tipo', ''));
    variantes.forEach((variant, index) => {
        const stock = Number(variant.stock || 0);
        if (stock <= 0) return;
        selectVariante.add(new Option(
            `Presentación ${variant.talle || 'Única'} · Tipo ${variant.color || 'Estándar'} · ${stock} u. disponibles`,
            String(index)
        ));
    });
    selector.dataset.productId = String(product.id);
    selector.hidden = false;
}

async function registrarVenta() { 
    if (!carritoVenta.length) return showError('Añadí al menos un producto antes de finalizar la venta.'); 
    const inputMetodo = document.getElementById('metodo_pago');
    const metodoPago = inputMetodo ? inputMetodo.value : '';
    if (!metodoPago) return showError('Seleccioná un método de pago.');

    const { totalFinal } = calcularTotalesVenta(); 
    
    try { 
        await window.asegurarColumnasVariantesVenta();
        const ahora = new Date();
        const fechaVenta = new Date(Date.UTC(
            ahora.getFullYear(),
            ahora.getMonth(),
            ahora.getDate(),
            12
        )).toISOString();
        const ventaRes = await executeNeonQuery(
            `WITH items AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS item(
                    producto_id TEXT, cantidad INTEGER, precio NUMERIC,
                    talle TEXT, color TEXT, articulo TEXT
                )
            ),
            productos_solicitados AS (
                SELECT producto_id, SUM(cantidad) AS cantidad
                FROM items
                GROUP BY producto_id
            ),
            variantes_solicitadas AS (
                SELECT producto_id, talle, color, SUM(cantidad) AS cantidad
                FROM items
                GROUP BY producto_id, talle, color
            ),
            productos_bloqueados AS (
                SELECT p.id, p.stock, solicitado.cantidad
                FROM productos p
                JOIN productos_solicitados solicitado ON p.id::text = solicitado.producto_id
                FOR UPDATE OF p
            ),
            variantes_bloqueadas AS (
                SELECT v.ctid, v.producto_id, v.talle, v.color, v.stock
                FROM producto_variantes v
                JOIN variantes_solicitadas solicitado
                    ON v.producto_id::text = solicitado.producto_id
                    AND v.talle = solicitado.talle
                    AND v.color = solicitado.color
                FOR UPDATE OF v
            ),
            variantes_totales AS (
                SELECT solicitado.producto_id, solicitado.talle, solicitado.color,
                    solicitado.cantidad, COUNT(bloqueada.ctid) AS filas,
                    COALESCE(SUM(bloqueada.stock), 0) AS stock
                FROM variantes_solicitadas solicitado
                LEFT JOIN variantes_bloqueadas bloqueada
                    ON bloqueada.producto_id::text = solicitado.producto_id
                    AND bloqueada.talle = solicitado.talle
                    AND bloqueada.color = solicitado.color
                GROUP BY solicitado.producto_id, solicitado.talle, solicitado.color, solicitado.cantidad
            ),
            stock_valido AS (
                SELECT
                    (SELECT COUNT(*) FROM productos_bloqueados) = (SELECT COUNT(*) FROM productos_solicitados)
                    AND (SELECT COUNT(*) FILTER (WHERE filas > 0) FROM variantes_totales) = (SELECT COUNT(*) FROM variantes_solicitadas)
                    AND COALESCE((SELECT BOOL_AND(stock >= cantidad) FROM productos_bloqueados), FALSE)
                    AND COALESCE((SELECT BOOL_AND(stock >= cantidad) FROM variantes_totales), FALSE) AS valido
            ),
            venta AS (
                INSERT INTO ventas (fecha, total, metodo_pago)
                SELECT ($2::timestamptz AT TIME ZONE 'UTC'), $3, $4
                FROM stock_valido
                WHERE valido
                RETURNING id
            ),
            productos_actualizados AS (
                UPDATE productos p
                SET stock = p.stock - solicitado.cantidad
                FROM productos_solicitados solicitado, venta
                WHERE p.id::text = solicitado.producto_id
                RETURNING p.id
            ),
            variantes_distribuidas AS (
                SELECT bloqueada.ctid, bloqueada.producto_id, bloqueada.talle, bloqueada.color,
                    bloqueada.stock, solicitado.cantidad,
                    COALESCE(SUM(bloqueada.stock) OVER (
                        PARTITION BY bloqueada.producto_id, bloqueada.talle, bloqueada.color
                        ORDER BY bloqueada.ctid
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                    ), 0) AS stock_previo
                FROM variantes_bloqueadas bloqueada
                JOIN variantes_solicitadas solicitado
                    ON bloqueada.producto_id::text = solicitado.producto_id
                    AND bloqueada.talle = solicitado.talle
                    AND bloqueada.color = solicitado.color
            ),
            variantes_actualizadas AS (
                UPDATE producto_variantes v
                SET stock = v.stock - LEAST(distribuida.stock, GREATEST(0, distribuida.cantidad - distribuida.stock_previo))
                FROM variantes_distribuidas distribuida, venta
                WHERE v.ctid = distribuida.ctid
                    AND LEAST(distribuida.stock, GREATEST(0, distribuida.cantidad - distribuida.stock_previo)) > 0
                RETURNING v.producto_id, v.talle, v.color
            ),
            variantes_actualizadas_unicas AS (
                SELECT DISTINCT producto_id, talle, color FROM variantes_actualizadas
            ),
            detalles AS (
                INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, talle, color, articulo)
                SELECT venta.id, productos_actualizados.id, items.cantidad, items.precio, items.talle, items.color, items.articulo
                FROM items
                CROSS JOIN venta
                JOIN productos_actualizados ON productos_actualizados.id::text = items.producto_id
                JOIN variantes_actualizadas_unicas
                    ON variantes_actualizadas_unicas.producto_id::text = items.producto_id
                    AND variantes_actualizadas_unicas.talle = items.talle
                    AND variantes_actualizadas_unicas.color = items.color
                RETURNING venta_id
            )
            SELECT (SELECT id FROM venta) AS id, (SELECT COUNT(*) FROM detalles) AS detalles`,
            [
                JSON.stringify(carritoVenta.map(item => ({
                    producto_id: String(item.id),
                    cantidad: item.cantidad,
                    precio: item.precio,
                    talle: item.talle,
                    color: item.color,
                    articulo: item.articulo
                }))),
                fechaVenta,
                totalFinal,
                metodoPago
            ]
        );
        if (!ventaRes[0]?.id || Number(ventaRes[0].detalles) !== carritoVenta.length) {
            throw new Error('El stock de uno o más productos cambió y ya no alcanza para completar la venta.');
        }

        carritoVenta = []; 
        if (selectMetodo) selectMetodo.value = '';
        actualizarTablaCarrito(); 
        await Promise.all([cargarProductos(), cargarResumen()]); 
        showSuccess('¡Venta Registrada! 🌿', 'La operación fue exitosa y el stock ha sido actualizado.'); 
    } catch (error) { 
        showError('No se pudo registrar la venta: ' + error.message); 
    } 
}

async function guardarProducto(event) { 
    event.preventDefault(); 
    const form = event.currentTarget; 
    try { 
        const priceCost = parsePrice(document.getElementById('precio_costo').value); 
        const priceSale = parsePrice(document.getElementById('precio_venta').value); 
        
        const nombreProducto = document.getElementById('nombre').value.trim();
        if (!nombreProducto || !Number.isFinite(priceCost) || priceCost <= 0 || !Number.isFinite(priceSale) || priceSale <= 0) {
            throw new Error('Completá los datos obligatorios con valores válidos.'); 
        }

        const filasVariantes = document.querySelectorAll('.variante-row');
        const listaVariantesValidas = [];
        let stockTotalGeneral = 0;

        for (const fila of filasVariantes) {
            const talle = fila.querySelector('.var-talle').value.trim();
            const color = fila.querySelector('.var-color').value.trim();
            const stockVar = Number(fila.querySelector('.var-stock').value);

            if (talle && color && Number.isInteger(stockVar) && stockVar >= 0) {
                listaVariantesValidas.push({ talle, color, stock: stockVar });
                stockTotalGeneral += stockVar;
            }
        }

        if (listaVariantesValidas.length === 0) {
            throw new Error('Ingresá al menos una presentación, tipo de paquete y stock válido.');
        }
        const variantesUnicas = new Set(listaVariantesValidas.map(variant => `${variant.talle.toLocaleLowerCase()}\u0000${variant.color.toLocaleLowerCase()}`));
        if (variantesUnicas.size !== listaVariantesValidas.length) {
            throw new Error('No repitas la misma combinación de presentación y tipo.');
        }

        const fotosVariantes = gestorFotosProducto?.getPhotos() || [];
        const coloresDisponibles = new Set(listaVariantesValidas.map(variant => variant.color.toLocaleLowerCase()));
        const fotoSinColor = fotosVariantes.find(foto => !foto.color || !coloresDisponibles.has(foto.color.toLocaleLowerCase()));
        if (fotoSinColor) {
            throw new Error('Asigná a cada foto un tipo que esté cargado en las variantes del producto.');
        }
        const fotoUrl = fotosVariantes[0]?.image || DEFAULT_IMAGE;
        
        const tallePrincipal = listaVariantesValidas[0].talle;
        const colorPrincipal = listaVariantesValidas[0].color;

        const product = { 
            nombre: nombreProducto, 
            marca: document.getElementById('marca').value.trim(), 
            talle: tallePrincipal,
            color: colorPrincipal,
            categoria: document.getElementById('categoria').value, 
            subcategoria: document.getElementById('subcategoria').value, 
            precio_costo: priceCost, 
            precio_venta: priceSale, 
            stock: stockTotalGeneral, 
            caracteristicas: document.getElementById('caracteristicas')?.value.trim() || '', 
            foto_url: fotoUrl 
        }; 
        
        await window.asegurarTablaVariantes();
        await window.asegurarColumnaFotosVariantes();
        await executeNeonQuery(
            `WITH producto AS (
                INSERT INTO productos (nombre, marca, talle, color, categoria, subcategoria, precio_costo, precio_venta, stock, caracteristicas, foto_url, fotos_variantes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
                RETURNING id
            ),
            variantes AS (
                INSERT INTO producto_variantes (producto_id, articulo, talle, color, stock)
                SELECT producto.id::text, producto.id::text, variante.talle, variante.color, variante.stock
                FROM producto
                CROSS JOIN jsonb_to_recordset($13::jsonb) AS variante(talle TEXT, color TEXT, stock INTEGER)
                RETURNING producto_id
            )
            SELECT id FROM producto`,
            [
                product.nombre, product.marca, product.talle, product.color, product.categoria,
                product.subcategoria, product.precio_costo, product.precio_venta, product.stock,
                product.caracteristicas, product.foto_url, JSON.stringify(fotosVariantes),
                JSON.stringify(listaVariantesValidas)
            ]
        );

        form.reset(); 
        const contenedorVariantes = document.getElementById('contenedor-variantes');
        const filasRestantes = [...(contenedorVariantes?.querySelectorAll('.variante-row') || [])];
        filasRestantes.slice(1).forEach(row => row.remove());
        gestorFotosProducto?.setPhotos([]);
        gestorFotosProducto?.setColors([]);
        await Promise.all([cargarProductos(), cargarResumen()]); 
        showSuccess('¡Producto Guardado! 🌿', 'El artículo y sus presentaciones fueron registrados con éxito.'); 
    } catch (error) { 
        showError(error.message); 
    } 
}

async function eliminarProducto(id) { 
    const product = productos.find(p => String(p.id) === String(id)); 
    const confirmation = await Swal.fire({ 
        title: '¿Seguro que quieres eliminar este producto?', 
        text: `Se eliminará "${product?.nombre || ''}" del inventario.`, 
        icon: 'warning', 
        showCancelButton: true, 
        confirmButtonColor: '#5c723f', 
        cancelButtonColor: '#a95c42', 
        confirmButtonText: 'Sí, eliminar', 
        cancelButtonText: 'Cancelar', 
        reverseButtons: true 
    }); 
    if (!confirmation.isConfirmed) return; 
    
    try {
        await executeNeonQuery(
            `WITH variantes AS (
                DELETE FROM producto_variantes
                WHERE producto_id::text = $1::text
                RETURNING producto_id
            ),
            eliminado AS (
                DELETE FROM productos
                WHERE id = $1 AND (SELECT COUNT(*) FROM variantes) >= 0
                RETURNING id
            )
            SELECT id FROM eliminado`,
            [id]
        );
        await Promise.all([cargarProductos(), cargarResumen()]); 
        showSuccess('¡Eliminado! 🗑️', 'El producto fue eliminado del inventario.'); 
    } catch (error) {
        showError('No se pudo eliminar: ' + error.message);
    }
}

function mostrarDetalle(product) { 
    const imagenProducto = document.getElementById('modal-foto-prod');
    imagenProducto.alt = `Imagen de ${product.nombre}`;
    setProductImage(imagenProducto, product.foto_url, product.foto);
    document.getElementById('modal-titulo-prod').textContent = product.nombre; 
    document.getElementById('modal-marca-prod').textContent = product.marca || 'N/A'; 
    const variantes = variantesPorProducto.get(String(product.id)) || [];
    document.getElementById('modal-talle-prod').textContent = variantes.map(variant => variant.talle || 'N/A').join(', ') || product.talle || 'N/A';
    document.getElementById('modal-color-prod').textContent = variantes.map(variant => variant.color || 'N/A').join(', ') || product.color || 'N/A';
    document.getElementById('modal-precio-prod').textContent = money(product.precio_venta); 
    document.getElementById('modal-stock-prod').textContent = product.stock; 
    document.getElementById('modal-info-prod').textContent = product.caracteristicas || 'Sin descripción.'; 
    document.getElementById('modal-detalles').style.display = 'flex'; 
}

function formatearFechaLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function obtenerRangoReporte(periodo, fechaReferencia) {
    const [year, month, day] = fechaReferencia.split('-').map(Number);
    const start = new Date(year, month - 1, day);
    let end = new Date(start);
    let label;
    if (periodo === 'day') {
        end.setDate(end.getDate() + 1);
        label = start.toLocaleDateString('es-AR');
    } else if (periodo === 'week') {
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        end = new Date(start);
        end.setDate(end.getDate() + 7);
        const lastDay = new Date(end);
        lastDay.setDate(lastDay.getDate() - 1);
        label = `${start.toLocaleDateString('es-AR')} al ${lastDay.toLocaleDateString('es-AR')}`;
    } else if (periodo === 'year') {
        start.setMonth(0, 1);
        end = new Date(start.getFullYear() + 1, 0, 1);
        label = String(start.getFullYear());
    } else {
        start.setDate(1);
        end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        label = start.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    }
    return { start: formatearFechaLocal(start), end: formatearFechaLocal(end), label };
}

function obtenerFechaVenta(fecha) {
    const text = String(fecha || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const timestampSinZona = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text);
    const parsed = new Date(timestampSinZona ? `${text.replace(' ', 'T')}Z` : text);
    return Number.isNaN(parsed.getTime()) ? '' : formatearFechaLocal(parsed);
}

function actualizarReporteFiltrado() {
    const periodo = document.getElementById('reporte-periodo').value;
    const fechaReferencia = document.getElementById('reporte-fecha').value;
    if (!fechaReferencia) return;
    const { start, end, label } = obtenerRangoReporte(periodo, fechaReferencia);
    const sales = ventasParaReporte.filter(sale => {
        const date = obtenerFechaVenta(sale.fecha);
        return date && date >= start && date < end;
    });
    const saleIds = new Set(sales.map(sale => String(sale.id)));
    const details = detallesParaReporte.filter(detail => saleIds.has(String(detail.venta_id)));
    const best = {};
    details.forEach(detail => {
        const productLabel = `${detail.nombre} (Presentación: ${detail.talle || '-'}, Tipo: ${detail.color || '-'})`;
        best[productLabel] = best[productLabel] || { brand: detail.marca || '-', count: 0 };
        best[productLabel].count += Number(detail.cantidad || 0);
    });
    const total = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const units = details.reduce((sum, detail) => sum + Number(detail.cantidad || 0), 0);
    const resultadoEst = document.getElementById('resultadoEstadisticas');
    if (resultadoEst) {
        const topProducts = Object.entries(best)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5);
        resultadoEst.innerHTML = `
            <h3 style="color:#2d3725;margin-bottom:12px;">Resumen: ${escapeHtml(label)}</h3>
            <div class="resumen-grid" style="margin-bottom:18px; display:flex; justify-content:space-around; text-align:center;">
                <div class="resumen-item"><p>Ventas</p><strong>${sales.length}</strong></div>
                <div class="resumen-item mid"><p>Total recaudado</p><strong>$${money(total)}</strong></div>
                <div class="resumen-item"><p>Unidades</p><strong>${units}</strong></div>
            </div>
            <h3 style="color:#2d3725;">🌿 Productos más Vendidos</h3>
            <ul style="list-style:none;padding:0;">${topProducts.map(([name, item]) => `<li style="padding:8px 0;border-bottom:1px solid #d4dfc7;display:flex;justify-content:space-between;gap:12px;"><span>📦 <strong>${escapeHtml(name)}</strong> (${escapeHtml(item.brand)})</span><strong>${item.count} un.</strong></li>`).join('') || '<li>No hay ventas en este período.</li>'}</ul>`;
    }
    window.reporte = { sales, best, label, units, total, stockGeneral: stockGeneralActual };
}

async function cargarReporte() { 
    await window.asegurarColumnasVariantesVenta();
    const [sales, details, totalStock] = await Promise.all([
        consultarVentasConFechaLocal(),
        executeNeonQuery(`
            SELECT dv.venta_id, dv.cantidad, p.nombre, p.marca, COALESCE(dv.talle, p.talle) AS talle, COALESCE(dv.color, p.color) AS color
            FROM detalle_venta dv 
            JOIN productos p ON dv.producto_id = p.id
        `),
        executeNeonQuery('SELECT COALESCE(SUM(stock), 0) AS total FROM productos')
    ]); 
    ventasParaReporte = sales || [];
    detallesParaReporte = details || [];
    stockGeneralActual = Number(totalStock[0]?.total || 0);
    actualizarReporteFiltrado();
}

function descargarReporte() { 
    const report = window.reporte || { sales: [], best: {}, label: 'período', units: 0, total: 0, stockGeneral: stockGeneralActual }; 
    const rows = [['Período', report.label], ['Cantidad de ventas', report.sales.length], ['Unidades vendidas', report.units], ['Total recaudado ($)', Number(report.total || 0).toFixed(2).replace('.', ',')]];
    rows.push([], ['Producto / Variante', 'Marca', 'Unidades Vendidas']); 
    Object.entries(report.best).forEach(([name, item]) => rows.push([name, item.brand, item.count])); 
    
    const csv = '\uFEFF' + rows.map(row => row.map(value => {
        const text = String(value ?? '');
        const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
        return `"${safeText.replace(/"/g, '""')}"`;
    }).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `reporte_yerbabaldolb_${document.getElementById('reporte-fecha').value}.csv`; 
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showSuccess('¡Reporte descargado!', 'El archivo CSV se generó con éxito.'); 
}

document.addEventListener('DOMContentLoaded', async () => { 
    if (!localStorage.getItem('usuario') || !['admin', 'vendedor'].includes(role)) {
        localStorage.removeItem('usuario');
        localStorage.removeItem('rol');
        localStorage.removeItem('usuario_id');
        window.location.replace('login.html');
        return;
    }
    aplicarRol(); 
    actualizarTablaCarrito(); 

    await Promise.all([
        cargarCategoriasYSubcategorias(),
        cargarMetodosPago()
    ]);
    
    const selectCat = document.getElementById('categoria');
    if (selectCat) selectCat.addEventListener('change', actualizarSubcategorias); 

    const paymentOptions = document.getElementById('payment-method-options');
    if (paymentOptions) {
        paymentOptions.addEventListener('click', event => {
            const button = event.target.closest('.payment-method-card');
            if (!button || button.disabled) return;

            const inputMetodo = document.getElementById('metodo_pago');
            if (!inputMetodo) return;
            inputMetodo.value = button.dataset.methodName;
            paymentOptions.querySelectorAll('.payment-method-card').forEach(card => {
                card.setAttribute('aria-pressed', String(card === button));
            });
            recalcularTotalVenta();
        });
    }

    const selectMetodoConfig = document.getElementById('metodo_pago_config');
    if (selectMetodoConfig) selectMetodoConfig.addEventListener('change', cargarConfiguracionMetodoPago);

    const selectTipoAjuste = document.getElementById('tipo_ajuste_config');
    if (selectTipoAjuste) selectTipoAjuste.addEventListener('change', actualizarCampoPorcentaje);

    const formMetodoPagoConfig = document.getElementById('form-config-metodo-pago');
    if (formMetodoPagoConfig) formMetodoPagoConfig.addEventListener('submit', guardarConfiguracionMetodoPago);
    
    const btnNewCat = document.getElementById('btn-nueva-categoria');
    if (btnNewCat) btnNewCat.addEventListener('click', agregarNuevaCategoria);

    const btnNewSub = document.getElementById('btn-nueva-subcategoria');
    if (btnNewSub) btnNewSub.addEventListener('click', agregarNuevaSubcategoria);

    const btnDelCat = document.getElementById('btn-eliminar-categoria');
    if (btnDelCat) btnDelCat.addEventListener('click', eliminarCategoriaSeleccionada);

    const btnDelSub = document.getElementById('btn-eliminar-subcategoria');
    if (btnDelSub) btnDelSub.addEventListener('click', eliminarSubcategoriaSeleccionada);

    const btnAddItem = document.getElementById('btn-agregar-item');
    if (btnAddItem) btnAddItem.addEventListener('click', agregarAlCarrito); 

    const prodBuscar = document.getElementById('producto_buscar');
    if (prodBuscar) {
        prodBuscar.addEventListener('input', seleccionarProductoVenta);
        prodBuscar.addEventListener('change', seleccionarProductoVenta);
        prodBuscar.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                seleccionarProductoVenta();
                const selectorVariante = document.getElementById('selector-variante-venta');
                const variante = document.getElementById('variante-venta');
                if (!selectorVariante.hidden) {
                    if (!variante.value) variante.focus();
                    else agregarAlCarrito();
                }
            }
        });
    }
    
    const tablaCarritoBody = document.querySelector('#tabla-carrito tbody');
    if (tablaCarritoBody) {
        tablaCarritoBody.addEventListener('click', event => { 
            const button = event.target.closest('.quitar-item'); 
            if (button) { carritoVenta.splice(Number(button.dataset.index), 1); actualizarTablaCarrito(); } 
        }); 
    }
    
    const formVentas = document.getElementById('form-ventas-multiples');
    if (formVentas) formVentas.addEventListener('submit', event => { event.preventDefault(); registrarVenta(); }); 

    const formProducto = document.getElementById('form-nuevo-producto');
    if (formProducto) formProducto.addEventListener('submit', guardarProducto); 

    const inputFotos = document.getElementById('foto');
    const contenedorFotos = document.getElementById('contenedor-fotos-producto');
    if (inputFotos && contenedorFotos) {
        gestorFotosProducto = crearGestorFotosProducto({
            input: inputFotos,
            contenedor: contenedorFotos,
            onError: message => showError(message)
        });
    }

    const contenedorVariantes = document.getElementById('contenedor-variantes');
    if (contenedorVariantes) {
        contenedorVariantes.addEventListener('click', event => {
            const addButton = event.target.closest('#btn-agregar-variante');
            const removeButton = event.target.closest('.btn-eliminar-variante');
            if (addButton) {
                const clone = addButton.closest('.variante-row').cloneNode(true);
                const add = clone.querySelector('#btn-agregar-variante');
                add.removeAttribute('id');
                add.className = 'btn-delete-dynamic btn-eliminar-variante';
                add.title = 'Quitar presentación';
                add.setAttribute('aria-label', add.title);
                add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg>';
                clone.querySelectorAll('input').forEach(input => {
                    if (input.classList.contains('var-stock')) input.value = '0';
                    else input.value = '';
                });
                contenedorVariantes.appendChild(clone);
                actualizarColoresFotosProducto();
            } else if (removeButton) {
                removeButton.closest('.variante-row').remove();
                actualizarColoresFotosProducto();
            }
        });
        contenedorVariantes.addEventListener('input', event => {
            if (event.target.matches('.var-color')) actualizarColoresFotosProducto();
        });
    }

    const tablaInventario = document.getElementById('tabla-inventario');
    if (tablaInventario) {
        tablaInventario.addEventListener('click', event => { 
            const button = event.target.closest('button'); 
            if (!button) return; 
            const product = productos.find(item => String(item.id) === button.dataset.id); 
            if (!product) return; 
            if (button.classList.contains('btn-ver')) mostrarDetalle(product); 
            if (button.classList.contains('btn-editar')) window.location.href = `editar-productos.html?id=${encodeURIComponent(product.id)}`; 
            if (button.classList.contains('btn-eliminar')) eliminarProducto(product.id); 
        }); 
    }
    
    const btnCloseModal = document.getElementById('btn-close-modal');
    if (btnCloseModal) btnCloseModal.addEventListener('click', () => { document.getElementById('modal-detalles').style.display = 'none'; });

    const btnReporte = document.getElementById('btnReporte');
    if (btnReporte) {
        btnReporte.addEventListener('click', async event => { 
            event.preventDefault(); 
            const modalRep = document.getElementById('modalReporte');
            if (modalRep) modalRep.style.display = 'flex'; 
            try { await cargarReporte(); } catch (error) { showError(error.message); } 
        }); 
    }

    const fechaReporte = document.getElementById('reporte-fecha');
    const periodoReporte = document.getElementById('reporte-periodo');
    if (fechaReporte && periodoReporte) {
        fechaReporte.value = formatearFechaLocal(new Date());
        fechaReporte.addEventListener('change', actualizarReporteFiltrado);
        periodoReporte.addEventListener('change', actualizarReporteFiltrado);
    }

    const fechaResumen = document.getElementById('resumen-fecha');
    const periodoResumen = document.getElementById('resumen-periodo');
    if (fechaResumen && periodoResumen) {
        fechaResumen.value = formatearFechaLocal(new Date());
        fechaResumen.addEventListener('change', actualizarMetricasResumen);
        periodoResumen.addEventListener('change', actualizarMetricasResumen);
    }

    const cerrarModalRep = document.getElementById('cerrarModalReporte');
    if (cerrarModalRep) cerrarModalRep.addEventListener('click', () => { document.getElementById('modalReporte').style.display = 'none'; }); 

    const btnDescargarReporte = document.getElementById('btn-descargar-reporte');
    if (btnDescargarReporte) btnDescargarReporte.addEventListener('click', descargarReporte);

    const btnSalir = document.getElementById('btn-salir');
    if (btnSalir) btnSalir.addEventListener('click', () => {
        localStorage.removeItem('usuario');
        localStorage.removeItem('rol');
        localStorage.removeItem('usuario_id');
        window.location.href = 'login.html';
    });
    
    try { 
        await Promise.all([cargarProductos(), cargarResumen()]); 
    } catch (error) { 
        showError(`No se pudo cargar la información: ${error.message}`); 
    } 
});