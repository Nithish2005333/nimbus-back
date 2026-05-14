const mongoose = require("mongoose");

const folderSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    name: { type: String, required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
    path: { type: String }, // Optional: for easier breadcrumbs construction if needed
    createdAt: { type: Date, default: Date.now },
    color: { type: String, default: 'blue' } // For UI customization
});

// Index for faster lookups of children
folderSchema.index({ userId: 1, parentId: 1 });

module.exports = mongoose.model("Folder", folderSchema);
