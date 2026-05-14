// middleware/auth.js
const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  try {
    const token = req.header("auth-token") || req.header("authorization");

    if (!token) {
      return res.status(401).json({
        success: false,
        msg: "No token provided"
      });
    }

    // Verify JWT token
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not set in environment variables");
      return res.status(500).json({
        success: false,
        msg: "Server configuration error"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Store user id on request
    req.user = decoded.id;

    if (!req.user) {
      return res.status(401).json({
        success: false,
        msg: "Invalid token: user ID not found"
      });
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        msg: "Token expired"
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        msg: "Invalid token"
      });
    }

    console.error("Auth middleware error:", err);
    return res.status(401).json({
      success: false,
      msg: "Authentication failed"
    });
  }
};
