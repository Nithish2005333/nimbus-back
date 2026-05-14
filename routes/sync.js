// routes/sync.js
// Remote pendrive sync - handles file transfers between devices
const router = require("express").Router();
const auth = require("../middleware/auth");
const fs = require("fs");
const path = require("path");
const FileModel = require("../models/File");

// Get storage path with Vercel/Serverless support
const getStoragePath = () => {
  // On Vercel, we MUST use /tmp for any write operations
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    return '/tmp';
  }
  return process.env.STORAGE_PATH || path.join(__dirname, "..", "storage");
};

// Check if this device can handle storage
const isStorageServer = () => {
  // If Cloudinary is configured, we can always act as a storage gateway
  if (process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    return true;
  }

  const storagePath = getStoragePath();
  try {
    if (fs.existsSync(storagePath)) {
      const testFile = path.join(storagePath, '.test-write-' + Date.now());
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return true;
    }
  } catch (err) {
    return false;
  }
  return false;
};

// GET /sync/status - Check sync status and storage server info
router.get("/status", auth, (req, res) => {
  try {
    const storageServer = isStorageServer();
    const storagePath = getStoragePath();
    
    res.json({
      success: true,
      isStorageServer: storageServer,
      storagePath: storagePath,
      storageAvailable: storageServer,
      message: storageServer 
        ? "This device has pendrive connected (Storage Server)" 
        : "This device is a client (Pendrive on another device)"
    });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /sync/file - Sync a file to storage server (from client device)
router.post("/file", auth, async (req, res) => {
  try {
    const { fileId, fileData, fileName, fileSize, encryptionSalt, encryptionIV, originalFileName } = req.body;
    
    if (!fileId || !fileData || !fileName) {
      return res.status(400).json({ 
        success: false, 
        msg: "Missing file data" 
      });
    }

    // Check if this is the storage server
    if (!isStorageServer()) {
      return res.status(400).json({ 
        success: false, 
        msg: "This device is not the storage server. Pendrive must be connected here." 
      });
    }

    const userId = req.user.toString();
    const baseStorage = getStoragePath();
    const userUploads = path.join(baseStorage, userId, "uploads");
    
    // Ensure directory exists
    if (!fs.existsSync(userUploads)) {
      fs.mkdirSync(userUploads, { recursive: true });
    }

    // Decode base64 file data (encrypted file)
    const buffer = Buffer.from(fileData, 'base64');
    // Define full path in the correct storage location
    const filePath = path.join(userUploads, fileName);

    // Write encrypted file to temp storage first
    fs.writeFileSync(filePath, buffer);

    // --- UPLOAD TO CLOUDINARY ---
    const { uploadToCloudinary } = require("../utils/cloudinary");
    let cloudinaryResult = null;
    try {
      const folderName = `${process.env.CLOUDINARY_FOLDER || 'NimbusCloud'}/${userId}`;
      cloudinaryResult = await uploadToCloudinary(filePath, {
        folder: folderName,
        resource_type: 'auto',
        public_id: fileName
      });
      
      // Cleanup local temp file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (cloudinaryErr) {
      console.error("[Cloudinary Sync] Error:", cloudinaryErr);
      // If we are not on Vercel, we can keep the local file as fallback
      if (process.env.VERCEL) {
        throw new Error("Cloudinary upload failed and local storage is restricted: " + cloudinaryErr.message);
      }
    }

    // Determine if file is encrypted
    const isEncrypted = !!(encryptionSalt && encryptionIV);
    const originalName = originalFileName || fileName.replace(/\.enc$/, '');

    // Save metadata to DB
    const newFile = new FileModel({
      userId: userId,
      filename: fileName,
      originalName: originalName,
      path: cloudinaryResult ? cloudinaryResult.secure_url : filePath,
      size: fileSize || buffer.length,
      isEncrypted: isEncrypted,
      encryptionSalt: encryptionSalt,
      encryptionIV: encryptionIV,
      storageMedia: cloudinaryResult ? 'cloudinary' : 'pendrive',
      storagePath: cloudinaryResult ? cloudinaryResult.secure_url : filePath,
      cloudinary_url: cloudinaryResult ? cloudinaryResult.secure_url : null,
      cloudinary_id: cloudinaryResult ? cloudinaryResult.public_id : null
    });
    
    await newFile.save();

    res.json({ 
      success: true, 
      msg: cloudinaryResult ? "File stored in Cloudinary successfully" : "File synced to local storage successfully",
      file: newFile
    });
  } catch (err) {
    console.error("Sync file error:", err);
    res.status(500).json({ 
      success: false, 
      msg: err.message || "Sync failed" 
    });
  }
});

// GET /sync/pending - Get pending files that need to be synced
router.get("/pending", auth, async (req, res) => {
  try {
    // This would track files uploaded on client devices
    // For now, return empty - can be enhanced with a queue system
    res.json({
      success: true,
      pendingFiles: [],
      message: "No pending files"
    });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

module.exports = router;

