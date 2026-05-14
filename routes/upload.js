// routes/upload.js
const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const auth = require("../middleware/auth");
const fs = require("fs");
const fsPromises = require("fs").promises;
const FileModel = require("../models/File");
const UserModel = require("../models/User");
const { uploadToCloudinary } = require("../utils/cloudinary");

// Helper: Parse storage plan (e.g., "10GB") to bytes
const parseStoragePlan = (planStr) => {
  const units = { 'KB': 1024, 'MB': 1024 ** 2, 'GB': 1024 ** 3, 'TB': 1024 ** 4 };
  const match = (planStr || "10GB").match(/^(\d+(?:\.\d+)?)\s*([A-Z]{2})$/i);
  if (!match) return 10 * units.GB;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  return value * (units[unit] || units.GB);
};

// Helper: Check if user has enough space
const checkStorageQuota = async (userId, incomingBytes) => {
  const user = await UserModel.findById(userId);
  if (!user) throw new Error("User not found");

  const limitBytes = parseStoragePlan(user.storagePlan);

  // Aggregate current usage
  const result = await FileModel.aggregate([
    { $match: { userId: userId.toString() } },
    { $group: { _id: null, totalUsage: { $sum: "$size" } } }
  ]);

  const currentUsed = result.length > 0 ? result[0].totalUsage : 0;

  console.log(`[Storage Check] User: ${userId}, Used: ${currentUsed / 1024 / 1024}MB, Incoming: ${incomingBytes / 1024 / 1024}MB, Limit: ${limitBytes / 1024 / 1024}MB`);

  if (currentUsed + incomingBytes > limitBytes) {
    console.warn(`[Storage Check] QUOTA EXCEEDED for User: ${userId}`);
    throw new Error("Storage Full, Please Upgrade");
  }
};

// Get storage path with fallback
const getStoragePath = () => {
  return process.env.STORAGE_PATH || path.join(__dirname, "..", "storage");
};

// Temp directory for chunked uploads
const getChunkTempPath = (userId, uploadId) => {
  const baseStorage = getStoragePath();
  const tempPath = path.join(baseStorage, userId, "temp", uploadId);
  if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath, { recursive: true });
  }
  return tempPath;
};

// Multer storage: writes to per-user uploads folder
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      if (!req.user) {
        return cb(new Error("User not authenticated"));
      }

      const userId = req.user.toString();
      const baseStorage = getStoragePath();
      const userUploads = path.join(baseStorage, userId, "uploads");

      if (!fs.existsSync(userUploads)) {
        fs.mkdirSync(userUploads, { recursive: true });
      }

      cb(null, userUploads);
    } catch (err) {
      console.error("Multer destination error:", err);
      cb(err);
    }
  },
  filename: function (req, file, cb) {
    try {
      const safeName = Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, safeName);
    } catch (err) {
      console.error("Multer filename error:", err);
      cb(err);
    }
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024, // 10GB
    files: 10,
    fieldSize: 10 * 1024 * 1024,
    fields: 20,
    parts: 30
  }
});

// --- ULTRA SPEED CHUNKED UPLOAD SYSTEM ---

// 1. Initialize Chunked Upload
router.post("/chunk/init", auth, async (req, res) => {
  try {
    const { fileName, totalSize, totalChunks } = req.body;

    // Check quota
    await checkStorageQuota(req.user, totalSize);

    const uploadId = Date.now() + "-" + Math.random().toString(36).substring(2, 10);

    // Create temp directory for this upload
    getChunkTempPath(req.user.toString(), uploadId);

    res.json({
      success: true,
      uploadId,
      msg: "Uplink initialized for ultra-speed transmission"
    });
  } catch (error) {
    if (error.message.includes("Storage Full")) {
      return res.status(400).json({ success: false, msg: error.message });
    }
    res.status(500).json({ success: false, msg: error.message });
  }
});

// 2. Process Chunk (Parallel-ready)
const chunkStorage = multer.memoryStorage();
const chunkUpload = multer({ storage: chunkStorage });

router.post("/chunk", auth, chunkUpload.single("chunk"), async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.body;
    const userId = req.user.toString();
    const tempDir = getChunkTempPath(userId, uploadId);
    const chunkPath = path.join(tempDir, `chunk-${chunkIndex}`);

    // Write chunk to disk asynchronously
    await fsPromises.writeFile(chunkPath, req.file.buffer);

    res.json({
      success: true,
      index: chunkIndex,
      msg: "Packet received"
    });
  } catch (error) {
    console.error("Chunk error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
});

// 3. Complete and Merge (Final Assembly)
router.post("/chunk/complete", auth, async (req, res) => {
  try {
    const { uploadId, fileName, totalChunks, encryptionSalt, encryptionIV, originalFileName, folderId, groupId } = req.body;
    const userId = req.user.toString();
    const tempDir = getChunkTempPath(userId, uploadId);

    const baseStorage = getStoragePath();
    const userUploads = path.join(baseStorage, userId, "uploads");
    if (!fs.existsSync(userUploads)) {
      fs.mkdirSync(userUploads, { recursive: true });
    }

    const finalName = Date.now() + "-" + fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const finalPath = path.join(userUploads, finalName);

    // Create write stream for final file - use highWaterMark for ultra speed
    const writeStream = fs.createWriteStream(finalPath, { highWaterMark: 1024 * 1024 });

    // Merge chunks in order using streams for maximum performance
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(tempDir, `chunk-${i}`);
      if (!fs.existsSync(chunkPath)) {
        throw new Error(`Packet loss at index ${i}: Uplink integrity compromised`);
      }

      const readStream = fs.createReadStream(chunkPath);
      await new Promise((resolve, reject) => {
        readStream.pipe(writeStream, { end: false });
        readStream.on("end", resolve);
        readStream.on("error", reject);
      });

      // Clean up chunk immediately
      await fsPromises.unlink(chunkPath);
    }

    writeStream.end();

    // Wait for the final write to flush
    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    // Cleanup temp folder
    await fsPromises.rm(tempDir, { recursive: true, force: true });

    // Get final file stats
    const stats = await fsPromises.stat(finalPath);

    // --- NEW: UPLOAD TO CLOUDINARY ---
    let cloudinaryResult = null;
    try {
      // Create user folder in Cloudinary: NimbusCloud/userId
      const folderName = `${process.env.CLOUDINARY_FOLDER || 'NimbusCloud'}/${userId}`;
      
      cloudinaryResult = await uploadToCloudinary(finalPath, {
        folder: folderName,
        resource_type: 'auto', // Handle all file types
        public_id: finalName // Use the generated safe name
      });
      
      console.log(`[Cloudinary] Asset uploaded successfully for user ${userId}: ${cloudinaryResult.secure_url}`);
      
      // Cleanup local file after successful upload
      await fsPromises.unlink(finalPath).catch(err => console.error("Local cleanup error:", err));
      
    } catch (cloudinaryErr) {
      console.error("[Cloudinary Uplink] Transmission failure:", cloudinaryErr);
      // Keep local file as fallback if needed, or throw error
      // In this case, we prefer Cloudinary, so let's continue but mark that it's local if failed
    }

    // Save metadata to database
    const newFile = new FileModel({
      userId,
      filename: finalName,
      originalName: originalFileName || fileName,
      path: cloudinaryResult ? cloudinaryResult.secure_url : finalPath, // Store URL or local path
      size: stats.size,
      isEncrypted: !!(encryptionSalt && encryptionIV),
      encryptionSalt,
      encryptionIV,
      folderId: (folderId && folderId !== 'null') ? folderId : null,
      sharedWithGroups: (groupId && groupId !== 'null') ? [{ groupId, sharedAt: new Date() }] : [],
      // Cloudinary specific fields
      storageMedia: cloudinaryResult ? 'cloudinary' : 'local',
      cloudinary_url: cloudinaryResult ? cloudinaryResult.secure_url : null,
      cloudinary_id: cloudinaryResult ? cloudinaryResult.public_id : null
    });

    await newFile.save();

    res.json({
      success: true,
      file: newFile,
      msg: "🚀 Asset reconstructed in vault with ultra-speed protocols"
    });
  } catch (error) {
    console.error("Assembly error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
});

// --- LEGACY SINGLE STREAM (Maintained for compatibility) ---

// Quota Check Middleware for Legacy Upload
const legacyQuotaCheck = async (req, res, next) => {
  try {
    const contentLength = parseInt(req.headers['content-length'] || '0');
    await checkStorageQuota(req.user, contentLength);
    next();
  } catch (e) {
    return res.status(400).json({ success: false, msg: e.message });
  }
};

router.post("/", auth, legacyQuotaCheck, (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, msg: "File too large. Maximum size is 10GB" });
        }
        return res.status(400).json({ success: false, msg: `Upload error: ${err.message}` });
      }
      return res.status(500).json({ success: false, msg: err.message || "Upload failed" });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, msg: "User not authenticated" });
    if (!req.file) return res.status(400).json({ success: false, msg: "No file uploaded" });

    const encryptionSalt = req.body.encryptionSalt || null;
    const encryptionIV = req.body.encryptionIV || null;
    const originalFileName = req.body.originalFileName || req.file.originalname;

    // --- NEW: UPLOAD TO CLOUDINARY (Legacy) ---
    let cloudinaryResult = null;
    try {
      const folderName = `${process.env.CLOUDINARY_FOLDER || 'NimbusCloud'}/${req.user.toString()}`;
      cloudinaryResult = await uploadToCloudinary(req.file.path, {
        folder: folderName,
        resource_type: 'auto',
        public_id: req.file.filename
      });

      // Cleanup local file
      await fsPromises.unlink(req.file.path).catch(err => console.error("Local cleanup error (legacy):", err));
    } catch (cloudinaryErr) {
      console.error("[Cloudinary Legacy Uplink] Transmission failure:", cloudinaryErr);
    }

    const newFile = new FileModel({
      userId: req.user.toString(),
      filename: req.file.filename,
      originalName: originalFileName,
      path: cloudinaryResult ? cloudinaryResult.secure_url : req.file.path,
      size: req.file.size,
      isEncrypted: !!(encryptionSalt && encryptionIV),
      encryptionSalt,
      encryptionIV,
      folderId: (req.body.folderId && req.body.folderId !== 'null') ? req.body.folderId : null,
      sharedWithGroups: (req.body.groupId && req.body.groupId !== 'null') ? [{ groupId: req.body.groupId, sharedAt: new Date() }] : [],
      storageMedia: cloudinaryResult ? 'cloudinary' : 'local',
      cloudinary_url: cloudinaryResult ? cloudinaryResult.secure_url : null,
      cloudinary_id: cloudinaryResult ? cloudinaryResult.public_id : null
    });

    await newFile.save();

    res.json({
      success: true,
      file: newFile
    });
  } catch (err) {
    console.error("Upload route error:", err);
    res.status(500).json({ success: false, msg: err.message || "Upload failed" });
  }
});

module.exports = router;
