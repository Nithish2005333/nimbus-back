// routes/storage.js
// Storage media configuration and management
const router = require("express").Router();
const auth = require("../middleware/auth");
const fs = require("fs");
const path = require("path");

// Get storage path with Vercel/Serverless support
const getStoragePath = () => {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    return '/tmp';
  }
  return process.env.STORAGE_PATH || path.join(__dirname, "..", "storage");
};

// GET /storage/media - Get available storage media
router.get("/media", auth, (req, res) => {
  try {
    const storagePath = getStoragePath();
    const storageMedia = process.env.STORAGE_MEDIA_TYPE || 'local';
    
    // Check if storage path exists and is accessible
    let isAvailable = false;
    let freeSpace = 0;
    let totalSpace = 0;
    
    try {
      if (fs.existsSync(storagePath)) {
        isAvailable = true;
        // On Node.js, we can't easily get disk space without additional packages
        // For now, just check if it's writable
        const testFile = path.join(storagePath, '.test-write');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        
        // Note: In production, you might want to use a package like 'diskusage' 
        // to get actual disk space information
      }
    } catch (err) {
      console.warn('Storage check failed:', err);
      isAvailable = false;
    }

    res.json({
      success: true,
      storage: {
        type: storageMedia, // 'local', 'pendrive', 'external', 'network'
        path: storagePath,
        available: isAvailable,
        freeSpace: freeSpace,
        totalSpace: totalSpace,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /storage/media - Configure storage media
router.post("/media", auth, async (req, res) => {
  try {
    const { storagePath, storageType } = req.body;
    
    // Validate storage type
    const validTypes = ['local', 'pendrive', 'external', 'network'];
    if (storageType && !validTypes.includes(storageType)) {
      return res.status(400).json({
        success: false,
        msg: `Invalid storage type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    // Validate storage path if provided
    if (storagePath) {
      // Check if path exists
      if (!fs.existsSync(storagePath)) {
        // Try to create it
        try {
          fs.mkdirSync(storagePath, { recursive: true });
        } catch (mkdirError) {
          return res.status(400).json({
            success: false,
            msg: `Storage path does not exist and cannot be created: ${mkdirError.message}`
          });
        }
      }

      // Check if path is writable
      try {
        const testFile = path.join(storagePath, '.test-write');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
      } catch (writeError) {
        return res.status(400).json({
          success: false,
          msg: `Storage path is not writable: ${writeError.message}`
        });
      }
    }

    // Note: In a production system, you might want to store these settings per-user
    // For now, we're using environment variables (set on server startup)
    // This endpoint provides feedback to the client about the current configuration

    res.json({
      success: true,
      msg: "Storage configuration accepted. Note: Server restart required for changes to take effect.",
      currentConfig: {
        type: process.env.STORAGE_MEDIA_TYPE || 'local',
        path: getStoragePath(),
      }
    });
  } catch (err) {
    console.error("Storage configuration error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

module.exports = router;

