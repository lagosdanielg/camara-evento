require('dotenv').config();
const express = require('express');
const QRCode = require('qrcode');
const cloudinary = require('cloudinary').v2;
const { conectarDB, Invitado, Foto, Config } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Generar QR
app.get('/qr', async (req, res) => {
    const url = `${req.protocol}://${req.get('host')}`;
    try {
        const qr = await QRCode.toDataURL(url);
        res.json({ qr });
    } catch (err) {
        res.status(500).json({ error: 'Error generando QR' });
    }
});

// Registrar invitado
app.post('/api/registro', async (req, res) => {
    const { nombre } = req.body;
    if (!nombre || nombre.trim() === '') {
        return res.status(400).json({ error: 'Nombre requerido' });
    }
    try {
        let invitado = await Invitado.findOne({ nombre: new RegExp(`^${nombre.trim()}$`, 'i') });
        if (!invitado) {
            invitado = await Invitado.create({ nombre: nombre.trim() });
        }
        res.json({ success: true, invitado });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error registrando invitado' });
    }
});

// Subir foto a Cloudinary
app.post('/api/foto', async (req, res) => {
    const { invitado_id, imagen } = req.body;
    if (!invitado_id || !imagen) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }
    try {
        const result = await cloudinary.uploader.upload(imagen, {
            folder: 'evento_fotos',
            quality: 'auto',
            fetch_format: 'auto'
        });
        const nuevaFoto = await Foto.create({
            invitado_id,
            imagen_url: result.secure_url,
            imagen_public_id: result.public_id,
            visible: false // Por defecto no visible hasta que el admin lo autorice
        });
        res.json({ success: true, foto_id: nuevaFoto._id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error guardando foto' });
    }
});

// Obtener fotos del invitado
app.get('/api/mis-fotos/:invitado_id', async (req, res) => {
    try {
        const fotos = await Foto.find({ invitado_id: req.params.invitado_id }).sort({ fecha_creacion: -1 });
        res.json({ fotos });
    } catch (err) {
        res.status(500).json({ error: 'Error obteniendo fotos' });
    }
});

// Eliminar foto
app.delete('/api/foto/:foto_id', async (req, res) => {
    try {
        const foto = await Foto.findById(req.params.foto_id);
        if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });
        await cloudinary.uploader.destroy(foto.imagen_public_id);
        await Foto.findByIdAndDelete(req.params.foto_id);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error eliminando foto' });
    }
});

// Panel admin - Obtener todas las fotos
app.get('/api/admin/fotos', async (req, res) => {
    try {
        const fotos = await Foto.find().populate('invitado_id', 'nombre').sort({ fecha_creacion: -1 });
        const fotosFormateadas = fotos.map(f => ({
            id: f._id,
            imagen: f.imagen_url,
            visible: f.visible,
            fecha_creacion: f.fecha_creacion,
            invitado_nombre: f.invitado_id ? f.invitado_id.nombre : 'Desconocido'
        }));
        res.json({ fotos: fotosFormateadas });
    } catch (err) {
        res.status(500).json({ error: 'Error obteniendo fotos' });
    }
});

// ✨ PANEL ADMIN: Cambiar visibilidad global (AHORA APRUEBA TODAS LAS FOTOS)
app.post('/api/admin/visibilidad', async (req, res) => {
    const { visible } = req.body;
    try {
        await Config.findByIdAndUpdate('global', { fotos_visibles: visible });
        
        // Si el admin activa la galería, hacemos visibles TODAS las fotos automáticamente
        if (visible) {
            await Foto.updateMany({}, { visible: true });
            console.log('✅ Galería activada: Todas las fotos marcadas como visibles');
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error actualizando visibilidad' });
    }
});

// Panel admin - Cambiar visibilidad de foto individual
app.post('/api/admin/foto/:foto_id/visibilidad', async (req, res) => {
    const { visible } = req.body;
    try {
        await Foto.findByIdAndUpdate(req.params.foto_id, { visible });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error actualizando visibilidad' });
    }
});

// Obtener configuración de visibilidad
app.get('/api/visibilidad', async (req, res) => {
    try {
        const config = await Config.findById('global');
        res.json({ fotos_visibles: config.fotos_visibles });
    } catch (err) {
        res.status(500).json({ error: 'Error obteniendo configuración' });
    }
});

// ✨ GALERÍA PÚBLICA: Con diagnósticos
app.get('/api/galeria', async (req, res) => {
    try {
        const config = await Config.findById('global');
        console.log('🔍 Galería solicitada. Estado global:', config.fotos_visibles);
        
        if (!config.fotos_visibles) {
            return res.json({ fotos: [], visible: false });
        }

        const fotos = await Foto.find({ visible: true })
            .populate('invitado_id', 'nombre')
            .sort({ fecha_creacion: -1 });
        
        console.log(`📸 Fotos encontradas y enviadas a la galería: ${fotos.length}`);

        const fotosFormateadas = fotos.map(f => ({
            id: f._id,
            imagen: f.imagen_url,
            fecha_creacion: f.fecha_creacion,
            invitado_nombre: f.invitado_id ? f.invitado_id.nombre : 'Desconocido'
        }));
        
        res.json({ fotos: fotosFormateadas, visible: true });
    } catch (err) {
        console.error('❌ Error en galería:', err);
        res.status(500).json({ error: 'Error obteniendo galería' });
    }
});

async function iniciar() {
    await conectarDB();
    app.listen(PORT, () => {
        console.log(`\n✅ Servidor corriendo en http://localhost:${PORT}`);
        console.log(`🔧 Panel admin: http://localhost:${PORT}/admin.html\n`);
    });
}

iniciar();