require('dotenv').config();
const fs = require('fs');
const path = require('path');

const archiverModule = require('archiver');
const archiver = archiverModule.default || archiverModule;

const axios = require('axios');
const mongoose = require('mongoose');
const { Foto } = require('./database');

// ============================================
// CONFIGURACIÓN
// ============================================
const OPCIONES = {
    soloVisibles: false,           // true = solo fotos aprobadas, false = todas
    organizarPorInvitado: true,    // true = crea subcarpetas por persona
    incluirMetadatos: true,        // true = crea archivo CSV con info
    nombreArchivo: 'fotos-evento'  // nombre del ZIP final
};

// ============================================
// FUNCIÓN PRINCIPAL
// ============================================
async function descargarFotos() {
    console.log('🚀 Iniciando descarga de fotos...\n');

    // 1. Conectar a MongoDB
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Conectado a MongoDB\n');
    } catch (err) {
        console.error('❌ Error conectando a MongoDB:', err.message);
        process.exit(1);
    }

    // 2. Obtener fotos según filtro
    const filtro = OPCIONES.soloVisibles ? { visible: true } : {};
    const fotos = await Foto.find(filtro).populate('invitado_id', 'nombre');
    
    if (fotos.length === 0) {
        console.log('⚠️  No hay fotos para descargar.');
        await mongoose.disconnect();
        return;
    }

    console.log(`📸 Se encontraron ${fotos.length} fotos para descargar.\n`);

    // 3. Crear directorio temporal
    const tempDir = path.join(__dirname, 'temp_descarga');
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
    }
    fs.mkdirSync(tempDir);

    // 4. Descargar cada foto
    let descargadas = 0;
    const errores = [];

    for (const foto of fotos) {
        try {
            const nombreInvitado = foto.invitado_id ? 
                sanitizarNombre(foto.invitado_id.nombre) : 'desconocido';
            
            let rutaArchivo;
            if (OPCIONES.organizarPorInvitado) {
                const carpetaInvitado = path.join(tempDir, nombreInvitado);
                if (!fs.existsSync(carpetaInvitado)) {
                    fs.mkdirSync(carpetaInvitado);
                }
                rutaArchivo = path.join(carpetaInvitado, `${foto._id}.jpg`);
            } else {
                rutaArchivo = path.join(tempDir, `${foto._id}.jpg`);
            }

            const response = await axios.get(foto.imagen_url, {
                responseType: 'stream',
                timeout: 30000
            });

            const writer = fs.createWriteStream(rutaArchivo);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            descargadas++;
            console.log(`  [${descargadas}/${fotos.length}] ✓ ${foto.invitado_id ? foto.invitado_id.nombre : 'desconocido'}`);
        } catch (err) {
            errores.push({ foto: foto._id, error: err.message });
            console.log(`  [${descargadas + 1}/${fotos.length}] ✗ Error: ${err.message}`);
        }
    }

    console.log(`\n✅ ${descargadas} fotos descargadas. ${errores.length} errores.\n`);

    // 5. Crear archivo de metadatos (CSV)
    if (OPCIONES.incluirMetadatos) {
        const csvContent = generarCSV(fotos);
        fs.writeFileSync(path.join(tempDir, 'metadatos.csv'), csvContent, 'utf8');
        console.log('📄 Archivo metadatos.csv creado.\n');
    }

    // 6. Crear archivo ZIP
    const zipPath = path.join(__dirname, `${OPCIONES.nombreArchivo}.zip`);
    await crearZIP(tempDir, zipPath);

    // 7. Limpiar directorio temporal
    fs.rmSync(tempDir, { recursive: true });

    // 8. Desconectar y finalizar
    await mongoose.disconnect();
    
    console.log('\n========================================');
    console.log(`🎉 ¡DESCARGA COMPLETADA!`);
    console.log(`📦 Archivo ZIP: ${zipPath}`);
    console.log(`📊 Total de fotos: ${descargadas}`);
    if (errores.length > 0) {
        console.log(`⚠️  Errores: ${errores.length}`);
    }
    console.log('========================================\n');
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================
function sanitizarNombre(nombre) {
    return nombre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

function generarCSV(fotos) {
    let csv = 'ID,Invitado,Fecha,Visible,URL\n';
    for (const foto of fotos) {
        const nombre = foto.invitado_id ? foto.invitado_id.nombre : 'desconocido';
        const fecha = new Date(foto.fecha_creacion).toISOString();
        const visible = foto.visible ? 'SI' : 'NO';
        csv += `"${foto._id}","${nombre}","${fecha}","${visible}","${foto.imagen_url}"\n`;
    }
    return csv;
}

function crearZIP(sourceDir, outPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
            console.log(`📦 ZIP creado: ${sizeMB} MB`);
            resolve();
        });

        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

// Ejecutar
descargarFotos().catch(err => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});