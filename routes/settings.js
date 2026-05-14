// routes/settings.js
const router = require("express").Router();
const User = require("../models/User");
const auth = require("../middleware/auth");

// GET user's API URL
router.get("/api-url", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user);
    if (!user) {
      return res.status(404).json({ success: false, msg: "User not found" });
    }

    res.json({ 
      success: true, 
      apiUrl: user.apiUrl || "" 
    });
  } catch (err) {
    console.error("Error getting API URL:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// SET user's API URL
router.post("/api-url", auth, async (req, res) => {
  try {
    const { apiUrl } = req.body;
    
    // Validate URL format
    if (apiUrl && apiUrl.trim() !== "") {
      try {
        new URL(apiUrl);
      } catch {
        return res.status(400).json({ 
          success: false, 
          msg: "Invalid URL format" 
        });
      }
    }

    const user = await User.findById(req.user);
    if (!user) {
      return res.status(404).json({ success: false, msg: "User not found" });
    }

    // Remove trailing slash
    const cleanUrl = apiUrl ? apiUrl.trim().replace(/\/$/, "") : "";
    
    user.apiUrl = cleanUrl;
    await user.save();

    res.json({ 
      success: true, 
      msg: "API URL updated successfully",
      apiUrl: cleanUrl 
    });
  } catch (err) {
    console.error("Error setting API URL:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// CLEAR user's API URL (reset to default)
router.delete("/api-url", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user);
    if (!user) {
      return res.status(404).json({ success: false, msg: "User not found" });
    }

    user.apiUrl = "";
    await user.save();

    res.json({ 
      success: true, 
      msg: "API URL reset to default" 
    });
  } catch (err) {
    console.error("Error clearing API URL:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

module.exports = router;

