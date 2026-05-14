// models/File.js
const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema({
  userId: { type: String, ref: 'User', required: true },
  filename: { type: String, required: true },
  originalName: { type: String },
  path: { type: String, required: true },
  size: { type: Number },
  uploadedAt: { type: Date, default: Date.now },
  // Zero-knowledge encryption metadata
  isEncrypted: { type: Boolean, default: true }, // All files are encrypted by default
  encryptionSalt: { type: String }, // Base64 encoded salt for key derivation
  encryptionIV: { type: String }, // Base64 encoded IV for AES-GCM
  // Storage media information (for multiple storage support)
  storageMedia: { type: String, default: 'local' }, // 'local', 'pendrive', 'external', 'network'
  storagePath: { type: String }, // Path on the storage media
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null }, // Null for root directory
  cloudinary_url: { type: String }, // URL from Cloudinary (if stored there)
  cloudinary_id: { type: String }, // Public ID from Cloudinary (for deletion)
  sharedWith: [{
    userId: { type: String, required: true },
    sharedAt: { type: Date, default: Date.now }
  }],
  sharedWithGroups: [{
    groupId: { type: String, required: true },
    sharedAt: { type: Date, default: Date.now }
  }]
});

module.exports = mongoose.model("File", fileSchema);
