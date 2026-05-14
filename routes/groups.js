// routes/groups.js
const router = require("express").Router();
const auth = require("../middleware/auth");
const GroupModel = require("../models/Group");
const UserModel = require("../models/User");
const FileModel = require("../models/File");

// Create group
router.post("/", auth, async (req, res) => {
  try {
    const { name, emails } = req.body;
    if (!name || !emails || !Array.isArray(emails)) {
      return res.status(400).json({ success: false, msg: "Group name and member emails are required" });
    }

    // Resolve emails to user details (avoid duplicate email lookup if any provided)
    const users = await UserModel.find({ email: { $in: emails } });
    const members = users.map(user => ({
      userId: user._id.toString(),
      email: user.email
    }));

    // Add owner as member too
    const owner = await UserModel.findById(req.user);
    if (!members.find(m => m.userId === req.user.toString())) {
      members.push({ userId: req.user.toString(), email: owner.email });
    }

    const group = new GroupModel({
      name,
      ownerId: req.user,
      members
    });

    await group.save();
    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// Get groups I'm member of
router.get("/", auth, async (req, res) => {
  try {
    const groups = await GroupModel.find({
      $or: [
        { ownerId: req.user },
        { "members.userId": req.user }
      ]
    }).populate("members.userId", "name email avatar");
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// Share a file with a group
router.post("/share-file/:id", auth, async (req, res) => {
  try {
    const { groupId } = req.body;
    if (!groupId) return res.status(400).json({ success: false, msg: "Group ID required" });

    const file = await FileModel.findById(req.params.id);
    if (!file) return res.status(404).json({ success: false, msg: "File not found" });

    // Check ownership
    if (file.userId.toString() !== req.user.toString()) {
      return res.status(403).json({ success: false, msg: "Only owner can share files" });
    }

    // Check if group exists
    const group = await GroupModel.findById(groupId);
    if (!group) return res.status(404).json({ success: false, msg: "Group not found" });

    // Check if already shared with group
    const alreadyShared = file.sharedWithGroups.some(g => g.groupId.toString() === groupId.toString());
    if (alreadyShared) return res.status(400).json({ success: false, msg: "Already shared with this group" });

    file.sharedWithGroups.push({ groupId });
    await file.save();

    res.json({ success: true, msg: `File shared with group: ${group.name}` });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

module.exports = router;
