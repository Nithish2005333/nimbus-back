const router = require("express").Router();
const User = require("../models/User");
const auth = require("../middleware/auth");

// GET /profile - Get current user profile
router.get("/profile", auth, async (req, res) => {
    try {
        console.log('=== GET PROFILE REQUEST ===');
        console.log('User ID:', req.user);

        const user = await User.findById(req.user).select("-password");
        if (!user) {
            return res.status(404).json({ success: false, msg: "User not found" });
        }

        console.log('User data from DB:', {
            id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            dob: user.dob,
            firstName: user.firstName,
            lastName: user.lastName,
            storagePlan: user.storagePlan,
            backupPreference: user.backupPreference,
            syncPreference: user.syncPreference,
            securityLevel: user.securityLevel
        });

        res.json({ success: true, user });
    } catch (err) {
        console.error('GET profile error:', err);
        res.status(500).json({ success: false, msg: "Server error" });
    }
});

// PUT /profile - Update current user profile
router.put("/profile", auth, async (req, res) => {
    try {
        console.log("PUT /profile req.body:", req.body);
        const {
            name, firstName, lastName, phone, dob, jobTitle, organization,
            location, bio, avatar, storagePlan, backupPreference,
            syncPreference, securityLevel
        } = req.body;

        // Build update object only with provided fields
        const updateFields = {};
        if (name !== undefined) updateFields.name = name;
        if (firstName !== undefined) updateFields.firstName = firstName;
        if (lastName !== undefined) updateFields.lastName = lastName;
        if (phone !== undefined) updateFields.phone = phone;
        if (dob !== undefined) updateFields.dob = dob;
        if (jobTitle !== undefined) updateFields.jobTitle = jobTitle;
        if (organization !== undefined) updateFields.organization = organization;
        if (location !== undefined) updateFields.location = location;
        if (bio !== undefined) updateFields.bio = bio;
        if (avatar !== undefined) updateFields.avatar = avatar;
        if (storagePlan !== undefined) updateFields.storagePlan = storagePlan;
        if (backupPreference !== undefined) updateFields.backupPreference = backupPreference;
        if (syncPreference !== undefined) updateFields.syncPreference = syncPreference;
        if (securityLevel !== undefined) updateFields.securityLevel = securityLevel;

        console.log('[DEBUG] Updating user profile for:', req.user);
        console.log('[DEBUG] Fields to update:', updateFields);

        const user = await User.findByIdAndUpdate(
            req.user,
            { $set: updateFields },
            { new: true, runValidators: true }
        ).select("-password");

        if (!user) {
            return res.status(404).json({ success: false, msg: "User not found" });
        }

        console.log('[DEBUG] Update successful. New user data:', user);
        res.json({ success: true, user, msg: "Profile updated successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: "Server error" });
    }
});

// GET /search - Search for users (for sharing)
router.get("/search", auth, async (req, res) => {
    try {
        const query = req.query.q || "";
        if (!query || query.length < 2) {
            return res.json({ success: true, users: [] });
        }

        // Find users matching name or email, excluding the current user
        const users = await User.find({
            $and: [
                { _id: { $ne: req.user } },
                {
                    $or: [
                        { name: { $regex: query, $options: "i" } },
                        { email: { $regex: query, $options: "i" } }
                    ]
                }
            ]
        })
            .select("name email avatar")
            .limit(10);

        res.json({ success: true, users });
    } catch (err) {
        console.error('Search users error:', err);
        res.status(500).json({ success: false, msg: "Server error" });
    }
});

module.exports = router;
