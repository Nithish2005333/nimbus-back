// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  firstName: { type: String, default: "" },
  lastName: { type: String, default: "" },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, default: "user" }, // user / admin
  apiUrl: { type: String, default: "" }, // User's preferred API URL
  phone: { type: String, required: true },
  dob: { type: String, required: true }, // Date of birth
  jobTitle: { type: String, default: "" },
  organization: { type: String, default: "" },
  location: { type: String, default: "" },
  bio: { type: String, default: "" },
  avatar: { type: String, default: "" }, // Base64 string or URL
  storagePlan: { type: String, default: "10GB" },
  backups: { type: String, default: "automatic" },
  syncPreference: { type: String, default: "real-time" },
  securityLevel: { type: String, default: "standard" },
  // WebAuthn / Passkey support
  currentChallenge: { type: String, default: "" },
  credentials: [{
    credentialID: { type: String, required: true },
    credentialPublicKey: { type: String, required: true },
    counter: { type: Number, required: true },
    transports: { type: [String], default: [] }
  }]
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
