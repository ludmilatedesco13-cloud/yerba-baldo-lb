// js/neon-config.js

// 1. Cargar el driver oficial Serverless de Neon desde CDN
import { neon } from 'https://esm.sh/@neondatabase/serverless';

// 2. Colocar aquí la cadena de conexión completa que copiaste de Neon
const DATABASE_URL = 'postgresql://neondb_owner:npg_RDpvw7btQ6is@ep-young-hall-be48uz8z-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const DATABASE_CONFIGURED = !DATABASE_URL.includes('******');

// 3. Inicializar la función de consultas HTTP
const sql = neon(DATABASE_URL);
let variantTableReady = false;
let saleVariantColumnsReady = false;
let productPhotosColumnReady = false;

/**
 * Función global para ejecutar consultas SQL en Neon
 * @param {string} queryText - Consulta SQL con parámetros numerados ($1, $2, etc.)
 * @param {Array} params - Arreglo con los valores de los parámetros
 */
async function executeNeonQuery(queryText, params = []) {
    try {
        if (!DATABASE_CONFIGURED) {
            throw new Error('La URL de conexión de Neon no está configurada. Reemplazá DATABASE_URL por la URL completa de tu proyecto.');
        }

        // Enviar la consulta y sus parámetros al motor Serverless de Neon
        const rows = await sql.query(queryText, params);
        return rows;
    } catch (error) {
        console.error('Error al ejecutar la consulta en Neon:', error);
        throw error;
    }
}

async function asegurarTablaVariantes() {
    if (variantTableReady) return;
    await executeNeonQuery(`
        CREATE TABLE IF NOT EXISTS producto_variantes (
            producto_id TEXT NOT NULL,
            articulo TEXT NOT NULL DEFAULT '',
            talle TEXT NOT NULL,
            color TEXT NOT NULL,
            stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
            PRIMARY KEY (producto_id, talle, color)
        )
    `);
    await executeNeonQuery("ALTER TABLE producto_variantes ADD COLUMN IF NOT EXISTS articulo TEXT NOT NULL DEFAULT ''");
    await executeNeonQuery("UPDATE producto_variantes SET articulo = producto_id WHERE articulo = ''");
    variantTableReady = true;
}

async function asegurarColumnasVariantesVenta() {
    if (saleVariantColumnsReady) return;
    await executeNeonQuery('ALTER TABLE detalle_venta ADD COLUMN IF NOT EXISTS talle TEXT');
    await executeNeonQuery('ALTER TABLE detalle_venta ADD COLUMN IF NOT EXISTS color TEXT');
    await executeNeonQuery("ALTER TABLE detalle_venta ADD COLUMN IF NOT EXISTS articulo TEXT");
    saleVariantColumnsReady = true;
}

async function asegurarColumnaFotosVariantes() {
    if (productPhotosColumnReady) return;
    await executeNeonQuery(`
        ALTER TABLE productos
        ADD COLUMN IF NOT EXISTS fotos_variantes JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    productPhotosColumnReady = true;
}

// Hacer la función accesible globalmente para app.js
window.executeNeonQuery = executeNeonQuery;
window.asegurarTablaVariantes = asegurarTablaVariantes;
window.asegurarColumnasVariantesVenta = asegurarColumnasVariantesVenta;
window.asegurarColumnaFotosVariantes = asegurarColumnaFotosVariantes;