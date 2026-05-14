const router = require("express").Router();
const auth = require("../middleware/auth");
const Folder = require("../models/Folder");
const File = require("../models/File");

// Create a new folder
router.post("/", auth, async (req, res) => {
    try {
        const { name, parentId } = req.body;
        if (!name) return res.status(400).json({ success: false, msg: "Folder name is required" });

        const folder = new Folder({
            userId: req.user,
            name,
            parentId: parentId || null
        });

        await folder.save();
        res.json({ success: true, folder });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// Get folders (optionally by parentId)
router.get("/", auth, async (req, res) => {
    try {
        const { parentId } = req.query;
        const query = { userId: req.user };

        // If parentId is provided, filter by it. If string 'null', filter for root.
        if (parentId !== undefined) {
            query.parentId = parentId === 'null' ? null : parentId;
        }

        const folders = await Folder.find(query).sort({ name: 1 });
        res.json({ success: true, folders });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// Move folder
router.patch("/move/:id", auth, async (req, res) => {
    try {
        const { parentId } = req.body;
        const targetParentId = !parentId || parentId === 'root' || parentId === 'null' ? null : parentId;

        const folder = await Folder.findOne({ _id: req.params.id, userId: req.user });
        if (!folder) return res.status(404).json({ success: false, msg: "Folder not found" });

        // Prevent moving into itself
        if (targetParentId && targetParentId.toString() === folder._id.toString()) {
            return res.status(400).json({ success: false, msg: "Cannot move a folder into itself" });
        }

        folder.parentId = targetParentId;
        await folder.save();
        res.json({ success: true, folder });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// Delete folder
router.delete("/:id", auth, async (req, res) => {
    try {
        const folder = await Folder.findOne({ _id: req.params.id, userId: req.user });
        if (!folder) return res.status(404).json({ success: false, msg: "Folder not found" });

        // Orphaned subfolders and files go to root
        await Folder.updateMany({ parentId: folder._id }, { parentId: null });
        await File.updateMany({ folderId: folder._id }, { folderId: null });

        await Folder.findByIdAndDelete(req.params.id);

        res.json({ success: true, msg: "Folder deleted, items moved to root" });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

// Rename folder
router.patch("/:id", auth, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ success: false, msg: "Name is required" });

        const folder = await Folder.findOne({ _id: req.params.id, userId: req.user });
        if (!folder) return res.status(404).json({ success: false, msg: "Folder not found" });

        folder.name = name;
        await folder.save();
        res.json({ success: true, folder });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

module.exports = router;
