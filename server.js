// server.js
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
dotenv.config();

const app = express();
const SERVER_ID = "NIMBUS_SERVER_v3_" + Date.now();
console.log(">>> SERVER IDENTITY:", SERVER_ID);

// 1. GLOBAL REQUEST LOGGER
app.use((req, res, next) => {
  const logMsg = `[${new Date().toISOString()}] [${SERVER_ID}] ${req.method} ${req.url}\n`;
  console.log(logMsg);
  next();
});

app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ extended: true, limit: '10gb' }));
app.use(cors());

// 2. BODY LOGGER
app.use((req, res, next) => {
  if (req.method !== 'GET') {
    const bodyLog = `[${SERVER_ID}] Body: ${JSON.stringify(req.body, null, 2)}\n---\n`;
    console.log(bodyLog);
    try {
      fs.appendFileSync(path.join(__dirname, 'server_trace.log'), `[${new Date().toISOString()}] ${bodyLog}`);
    } catch (e) { }
  }
  next();
});

// connect mongo
const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
  console.error("CRITICAL ERROR: MONGO_URL environment variable is missing!");
  // In a serverless environment, we might want to still start the server 
  // but all DB-dependent routes will fail. 
  // However, it's better to log it clearly.
} else {
  mongoose.connect(MONGO_URL)
    .then(() => console.log("MongoDB Connected Successfully"))
    .catch(err => {
      console.error("MongoDB Connection Error:");
      console.error(err);
    });
}

// ensure base storage path exists
const baseStorage = process.env.STORAGE_PATH || path.join(__dirname, "storage");

// Check and create storage directory with better error handling
try {
  // Check if parent directory exists (for custom paths like F:\NimbusCloud)
  const parentDir = path.dirname(baseStorage);
  if (baseStorage.includes(':') && !fs.existsSync(parentDir)) {
    console.warn(`Warning: Parent directory does not exist: ${parentDir}`);
    console.warn(`Falling back to default storage: ${path.join(__dirname, "storage")}`);
    // Fall back to default storage if custom path doesn't exist
    const defaultStorage = path.join(__dirname, "storage");
    if (!fs.existsSync(defaultStorage)) {
      fs.mkdirSync(defaultStorage, { recursive: true });
      console.log("Created default storage at", defaultStorage);
    }
  } else {
    // Try to create the storage directory
    if (!fs.existsSync(baseStorage)) {
      fs.mkdirSync(baseStorage, { recursive: true });
      console.log("Created base storage at", baseStorage);
    }
  }
} catch (err) {
  console.error("Error creating storage directory:", err.message);
  // Use default storage as fallback
  const defaultStorage = path.join(__dirname, "storage");
  try {
    if (!fs.existsSync(defaultStorage)) {
      fs.mkdirSync(defaultStorage, { recursive: true });
      console.log("Using fallback storage at", defaultStorage);
    }
  } catch (fallbackErr) {
    console.error("Failed to create fallback storage:", fallbackErr.message);
  }
}

// routes
const authRoute = require("./routes/auth");
const uploadRoute = require("./routes/upload");
const filesRoute = require("./routes/files");
const syncRoute = require("./routes/sync");
const settingsRoute = require("./routes/settings");
const storageRoute = require("./routes/storage");

const userRoute = require("./routes/user");
const foldersRoute = require("./routes/folders");
const groupsRoute = require("./routes/groups");

app.use("/auth", authRoute);
app.use("/upload", uploadRoute);
app.use("/files", filesRoute);
app.use("/sync", syncRoute);
app.use("/settings", settingsRoute);
app.use("/storage", storageRoute);
app.use("/user", userRoute);
app.use("/folders", foldersRoute);
app.use("/groups", groupsRoute);

// default index
app.get("/", (req, res) => res.send("MyCloud Backend Running successfully!"));

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  res.status(err.status || 500).json({
    success: false,
    msg: err.message || "Internal server error",
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    msg: "Route not found"
  });
});

// start
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log("Server running on port", PORT);
  console.log("Storage path:", process.env.STORAGE_PATH || path.join(__dirname, "storage"));
  console.log("MongoDB URL:", process.env.MONGO_URL ? "Configured" : "Not configured");
  console.log("JWT Secret:", process.env.JWT_SECRET ? "Configured" : "Not configured");
});

// Set server timeout to 2 hours for large file uploads (default is 2 minutes)
server.timeout = 2 * 60 * 60 * 1000; // 2 hours
server.keepAliveTimeout = 2 * 60 * 60 * 1000; // Keep connections alive for 2 hours
server.headersTimeout = 2 * 60 * 60 * 1000 + 1000; // Slightly longer than keepAliveTimeout
