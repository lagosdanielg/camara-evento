const mongoose = require('mongoose');

// ============================================
// DEFINICIÓN DE MODELOS (ESQUEMAS)
// ============================================

const invitadoSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true },
    fecha_creacion: { type: Date, default: Date.now }
});

const fotoSchema = new mongoose.Schema({
    invitado_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Invitado', required: true },
    imagen_url: { type: String, required: true },
    imagen_public_id: { type: String, required: true },
    visible: { type: Boolean, default: false },
    fecha_creacion: { type: Date, default: Date.now }
});

const configSchema = new mongoose.Schema({
    _id: { type: String, default: 'global' },
    fotos_visibles: { type: Boolean, default: false }
});

const Invitado = mongoose.model('Invitado', invitadoSchema);
const Foto = mongoose.model('Foto', fotoSchema);
const Config = mongoose.model('Config', configSchema);

// ============================================
// FUNCIÓN DE CONEXIÓN
// ============================================
async function conectarDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Conectado a MongoDB Atlas');
        
        const configExistente = await Config.findById('global');
        if (!configExistente) {
            await Config.create({ _id: 'global', fotos_visibles: false });
            console.log('✅ Configuración inicial creada');
        }
    } catch (err) {
        console.error('❌ Error conectando a MongoDB:', err.message);
        process.exit(1);
    }
}

module.exports = { conectarDB, Invitado, Foto, Config };