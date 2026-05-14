// routes/files.js
const router = require("express").Router();
const auth = require("../middleware/auth");
const FileModel = require("../models/File");
const FolderModel = require("../models/Folder");
const UserModel = require("../models/User");
const GroupModel = require("../models/Group");
const path = require("path");
const fs = require("fs");
const { deleteFromCloudinary } = require("../utils/cloudinary");
const axios = require("axios"); // I'll need axios to proxy or just redirect

// Get files for logged-in user (including shared & group shared)
router.get("/", auth, async (req, res) => {
  try {
    // Find groups the user is member of
    const userGroups = await GroupModel.find({
      $or: [
        { ownerId: req.user },
        { "members.userId": req.user }
      ]
    }).select('_id');
    const groupIds = userGroups.map(g => g._id.toString());

    const files = await FileModel.find({
      $or: [
        { userId: req.user },
        { "sharedWith.userId": req.user },
        { "sharedWithGroups.groupId": { $in: groupIds } }
      ]
    }).populate("userId", "email name avatar").populate("sharedWith.userId", "email name avatar").sort({ uploadedAt: -1 });
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// Get files list (alternative endpoint)
router.get("/list", auth, async (req, res) => {
  try {
    const userGroups = await GroupModel.find({
      $or: [
        { ownerId: req.user },
        { "members.userId": req.user }
      ]
    }).select('_id');
    const groupIds = userGroups.map(g => g._id.toString());

    const files = await FileModel.find({
      $or: [
        { userId: req.user },
        { "sharedWith.userId": req.user },
        { "sharedWithGroups.groupId": { $in: groupIds } }
      ]
    }).populate("userId", "email name avatar").populate("sharedWith.userId", "email name avatar").sort({ uploadedAt: -1 });
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// Download a file by fileId (only owner)
router.get("/download/:id", auth, async (req, res) => {
  try {
    console.log('=== DOWNLOAD REQUEST ===');
    console.log('File ID:', req.params.id);
    console.log('Authenticated User ID:', req.user);
    console.log('User ID Type:', typeof req.user);

    const file = await FileModel.findById(req.params.id).populate("userId", "email");

    if (!file) {
      return res.status(404).json({ success: false, msg: "File not found" });
    }

    // Find groups the user is member of
    const userGroups = await GroupModel.find({
      $or: [
        { ownerId: req.user },
        { "members.userId": req.user }
      ]
    }).select('_id');
    const groupIds = userGroups.map(g => g._id.toString());

    // Check authorization: Owner OR shared user OR group member
    const isOwner = file.userId._id.toString() === req.user.toString();
    const isShared = file.sharedWith?.some(s => s.userId.toString() === req.user.toString());
    const isGroupShared = file.sharedWithGroups?.some(g => groupIds.includes(g.groupId.toString()));

    if (!isOwner && !isShared && !isGroupShared) {
      console.log('Authorization FAILED - Not owner, shared user, or group member');
      return res.status(403).json({ success: false, msg: "Not authorized to download this file" });
    }

    const downloadName = file.originalName || file.filename;

    // --- NEW: CLOUDINARY DOWNLOAD HANDLER ---
    if (file.storageMedia === 'cloudinary' || file.path.startsWith('http')) {
      console.log('Redirecting to Cloudinary asset:', file.path);
      // For encrypted files, we just send the URL and the client might fetch it
      // Or we can redirect, but some clients (mobile) might prefer the direct URL in response
      return res.redirect(file.path);
      
      // Alternative: Proxy if we want to force download name or handle headers
      /*
      try {
        const response = await axios({
          method: 'get',
          url: file.path,
          responseType: 'stream'
        });
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
        response.data.pipe(res);
        return;
      } catch (proxyErr) {
        console.error('Cloudinary proxy error:', proxyErr);
        return res.status(500).json({ success: false, msg: 'Error fetching from cloud' });
      }
      */
    }

    const filePath = file.path;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        msg: "File missing on disk. It may have been moved or deleted."
      });
    }

    // Download file with proper error handling
    res.download(filePath, downloadName, (err) => {
      if (err) {
        console.error('File download error:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, msg: 'Error downloading file' });
        }
      }
    });
  } catch (err) {
    console.error('Download route error:', err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// Delete file by id (owner)
router.delete("/:id", auth, async (req, res) => {
  try {
    const file = await FileModel.findById(req.params.id);
    if (!file) return res.status(404).json({ success: false, msg: "File not found" });
    if (file.userId !== req.user) return res.status(403).json({ success: false, msg: "Not authorized" });

    // delete from storage
    if (file.storageMedia === 'cloudinary' && file.cloudinary_id) {
      try {
        // Determine resource type (raw or image/video)
        // Since it's encrypted, it's usually uploaded as 'raw' if we didn't specify auto
        // But our upload utility uses 'auto', so we might need to check or just try raw
        await deleteFromCloudinary(file.cloudinary_id, 'raw');
      } catch (cloudDelErr) {
        console.error("Cloudinary deletion failed:", cloudDelErr);
      }
    } else if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    await FileModel.findByIdAndDelete(req.params.id);

    // append log
    const baseStorage = process.env.STORAGE_PATH || path.join(__dirname, "..", "storage");
    const logPath = path.join(baseStorage, req.user.toString(), "logs", "activity.log");
    if (fs.existsSync(path.dirname(logPath))) {
      fs.appendFileSync(logPath, `DELETE: ${file.filename}, TIME: ${new Date().toISOString()}, MEDIA: ${file.storageMedia || 'local'}\n`);
    }

    res.json({ success: true, msg: "Deleted" });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// Rename file
router.patch("/rename/:id", auth, async (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName || typeof newName !== 'string' || newName.trim() === '') {
      return res.status(400).json({ success: false, msg: "Invalid new name provided" });
    }

    const file = await FileModel.findById(req.params.id);
    if (!file) return res.status(404).json({ success: false, msg: "File not found" });
    if (file.userId !== req.user) return res.status(403).json({ success: false, msg: "Not authorized" });

    const baseStorage = process.env.STORAGE_PATH || path.join(__dirname, "..", "storage");
    const oldPath = file.path;
    const fileDir = path.dirname(oldPath);

    let safeNewName = newName.trim();

    // CRITICAL FIX: Preserve .enc extension for encrypted files on disk
    // If the file is encrypted, the physical file MUST end with .enc (or whatever scheme we use)
    // This prevents the "decrypted on rename" bug where removing .enc makes the OS treat it as a valid (but corrupt) file
    if (file.isEncrypted) {
      // Ensure specific extension presence
      if (!safeNewName.endsWith('.enc')) {
        safeNewName += '.enc';
      }
    }

    const newPath = path.join(fileDir, safeNewName);

    // Check if new name file already exists
    if (fs.existsSync(newPath) && newPath !== oldPath) {
      return res.status(400).json({ success: false, msg: "A file with this name already exists" });
    }

    // Rename file on disk
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
    }

    // Update database
    // We store the LOGICAL name (what user sees) and the PHYSICAL path separately
    file.originalName = newName.trim(); // User sees "video.mp4"
    file.path = newPath;                // Disk has "video.mp4.enc"
    await file.save();

    // Append log
    const logPath = path.join(baseStorage, req.user.toString(), "logs", "activity.log");
    if (fs.existsSync(path.dirname(logPath))) {
      fs.appendFileSync(logPath, `RENAME: ${file.filename} -> ${newName.trim()}, TIME: ${new Date().toISOString()}\n`);
    }

    res.json({ success: true, msg: "File renamed", file });
  } catch (err) {
    console.error("Rename error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// Move file to folder (Updated for Virtual Folders)
router.patch("/move/:id", auth, async (req, res) => {
  try {
    const { folderId } = req.body;

    // Validate folderId if provided
    if (folderId && folderId !== 'root') {
      const folder = await FolderModel.findById(folderId);
      if (!folder) return res.status(404).json({ success: false, msg: "Target folder not found" });
    }

    const file = await FileModel.findById(req.params.id);
    if (!file) return res.status(404).json({ success: false, msg: "File not found" });
    if (file.userId !== req.user) return res.status(403).json({ success: false, msg: "Not authorized" });

    // Update folderId (null for root)
    file.folderId = (folderId === 'root' || !folderId) ? null : folderId;

    // We do NOT move physical files anymore as we switched to virtual folders.
    // The physical paths remain as they were at upload time.

    await file.save();

    res.json({ success: true, msg: "File moved", file });
  } catch (err) {
    console.error("Move error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// SHARE FILE
router.post("/share/:id", auth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, msg: "Email required" });

    const file = await FileModel.findById(req.params.id);
    if (!file) return res.status(404).json({ success: false, msg: "File not found" });

    // Only Owner can share
    if (file.userId.toString() !== req.user.toString()) {
      return res.status(403).json({ success: false, msg: "Only owner can share files" });
    }

    // Find recipient user
    const recipient = await UserModel.findOne({ email });
    if (!recipient) return res.status(404).json({ success: false, msg: "User with this email not found" });

    if (recipient._id.toString() === req.user.toString()) {
      return res.status(400).json({ success: false, msg: "Cannot share file with yourself" });
    }

    // Check if already shared
    const alreadyShared = file.sharedWith.some(s => s.userId.toString() === recipient._id.toString());
    if (alreadyShared) return res.status(400).json({ success: false, msg: "File already shared with this user" });

    // Share
    file.sharedWith.push({ userId: recipient._id.toString() });
    await file.save();

    res.json({ success: true, msg: `File shared with ${email}` });
  } catch (err) {
    console.error("Share error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// GET RECENT SHARES (Like a chat/feed)
router.get("/recent-shares", auth, async (req, res) => {
  try {
    // Find groups user is in
    const userGroups = await GroupModel.find({
      $or: [
        { ownerId: req.user },
        { "members.userId": req.user }
      ]
    }).select('_id');
    const groupIds = userGroups.map(g => g._id.toString());

    const files = await FileModel.find({
      $or: [
        { userId: req.user, "sharedWith.0": { $exists: true } },
        { userId: req.user, "sharedWithGroups.0": { $exists: true } },
        { "sharedWith.userId": req.user },
        { "sharedWithGroups.groupId": { $in: groupIds } }
      ]
    }).populate("userId", "email name avatar").sort({ uploadedAt: -1 }).limit(20);

    // Filter/Transform for the feed
    const feed = files.map(file => {
      const isOwner = file.userId._id.toString() === req.user.toString();

      return {
        _id: file._id,
        filename: file.filename,
        originalName: file.originalName,
        size: file.size,
        ownerEmail: file.userId.email,
        ownerName: file.userId.name || file.userId.email.split('@')[0],
        ownerAvatar: file.userId.avatar,
        sharedAt: file.sharedWith[0]?.sharedAt || file.sharedWithGroups[0]?.sharedAt || file.uploadedAt,
        type: isOwner ? "sent" : "received"
      };
    });

    res.json({ success: true, shares: feed });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

module.exports = router;
