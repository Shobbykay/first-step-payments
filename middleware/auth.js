const jwt = require("jsonwebtoken");
const pool = require("../services/db"); // adjust this path to your MySQL connection

// SUPERADMIN AUTH MIDDLEWARE
module.exports = async (req, res, next) => {
  try {
    // Get token from headers (Bearer <token>)
    const authHeader = req.headers["authorization"];
    if (!authHeader) {
      return res.status(401).json({ status: false, message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ status: false, message: "Token missing" });
    }

    // Verify token synchronously
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret");
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ status: false, message: "Token expired" });
      }
      return res.status(401).json({ status: false, message: "Invalid token" });
    }

    // check DB
    const [rows] = await pool.query(
      "SELECT user_id FROM admin_users WHERE user_id = ? LIMIT 1",
      [decoded.user_id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ status: false, message: "Invalid admin user" });
    }

    // Attach decoded payload to request
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};
