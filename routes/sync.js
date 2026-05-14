// routes/sync.js
// Remote pendrive sync - handles file transfers between devices
const router = require("express").Router();
const auth = require("../middleware/auth");
const fs = require("fs");
const path = require("path");
const FileModel = require("../models/File");

// Get storage path
const getStoragePath = () => {
  return process.env.STORAGE_PATH || path.join(__dirname, "..", "storage");
};

// Check if this device has the pendrive (is the storage server)
const isStorageServer = () => {
  const storagePath = getStoragePath();
  // Check if storage path exists and is writable (pendrive connected)
  try {
    if (fs.existsSync(storagePath)) {
      // Try to write a test file
      const testFile = path.join(storagePath, '.test-write');
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
    const filePath = path.join(userUploads, fileName);
    
    // Write encrypted file to pendrive/hard disk
    fs.writeFileSync(filePath, buffer);

    // Determine if file is encrypted
    const isEncrypted = !!(encryptionSalt && encryptionIV);
    const originalName = originalFileName || fileName.replace(/\.enc$/, ''); // Remove .enc if present

    // Save metadata to DB (including encryption info)
    const newFile = new FileModel({
      userId: userId,
      filename: fileName, // Encrypted filename on disk
      originalName: originalName, // Original filename (for user display)
      path: filePath,
      size: fileSize || buffer.length,
      isEncrypted: isEncrypted,
      encryptionSalt: encryptionSalt,
      encryptionIV: encryptionIV,
      storageMedia: process.env.STORAGE_MEDIA_TYPE || 'pendrive',
      storagePath: filePath
    });
    
    await newFile.save();

    // Log activity
    try {
      const logsDir = path.join(baseStorage, userId, "logs");
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      const logLine = `SYNC_UPLOAD: ${fileName}, SIZE: ${buffer.length}, TIME: ${new Date().toISOString()}\n`;
      const logPath = path.join(logsDir, "activity.log");
      fs.appendFileSync(logPath, logLine);
    } catch (logError) {
      console.error("Failed to write activity log:", logError);
    }

    res.json({ 
      success: true, 
      msg: "File synced to pendrive successfully",
      file: {
        _id: newFile._id,
        filename: fileName,
        path: filePath,
        size: buffer.length
      }
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

