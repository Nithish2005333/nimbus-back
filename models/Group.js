// models/Group.js
const mongoose = require("mongoose");

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  ownerId: { type: String, ref: 'User', required: true },
  members: [{
    userId: { type: String, ref: 'User', required: true },
    email: { type: String }
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Group", groupSchema);
