const pool = require('../services/db');
const jwt = require("jsonwebtoken");
const { sendMail } = require("../utils/mailHelper");
const crypto = require('crypto');
const logAction = require("../utils/logger");

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const path = require("path");
const uploadToS3Buffer = require("../utils/s3Upload");


// allowed document types
const ALLOWED_DOC_TYPES = ["DRIVERS_LICENSE", "INTL_PASSPORT", "NATIONAL_ID", "SELFIE"];
const ALLOWED_FILE_TYPES = [".jpg", ".jpeg", ".png", ".pdf"];


// UPLOAD KYC DOCUMENTS
exports.uploadKycDocuments = [
  upload.single("document"), // form-data field name: "document"
  async (req, res) => {
    const { user_id } = req.user || {};
    const { document_type } = req.body;

    if (!user_id) {
      return res.status(401).json({ status: false, message: "Unauthorized" });
    }

    if (!document_type || !ALLOWED_DOC_TYPES.includes(document_type)) {
      return res.status(400).json({
        status: false,
        message: `document_type is required and must be one of: ${ALLOWED_DOC_TYPES.join(", ")}`
      });
    }

    if (!req.file) {
      return res.status(400).json({ status: false, message: "Document file is required" });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!ALLOWED_FILE_TYPES.includes(ext)) {
      return res.status(400).json({
        status: false,
        message: "Only JPG, PNG, and PDF files are allowed"
      });
    }

    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ status: false, message: "File size must not exceed 5MB" });
    }

    try {
      // Fetch user details
      const [userResult] = await pool.query(
        "SELECT email_address, first_name, password FROM users_account WHERE user_id = ? LIMIT 1",
        [user_id]
      );

      if (userResult.length === 0) {
        return res.status(404).json({
          status: false,
          message: "User not found",
        });
      }

      const userEmail = userResult[0].email_address;

      // Check if document already exists for this user
      const [existing] = await pool.query(
        "SELECT user_id FROM customer_kyc WHERE user_id = ? AND document_type = ? LIMIT 1",
        [user_id, document_type]
      );

      if (existing.length > 0) {
        return res.status(200).json({
          status: false,
          message: `${document_type} already uploaded for this user`
        });
      }

      // Upload to S3
      const folder = `kyc/${document_type.toLowerCase()}`;
      const fileKey = `${folder}/${user_id}_${Date.now()}${ext}`;
      const fileUrl = await uploadToS3Buffer(req.file.buffer, fileKey, req.file.mimetype);

      // Insert into DB
      await pool.query(
        "INSERT INTO customer_kyc (user_id, document_type, document_link) VALUES (?, ?, ?)",
        [user_id, document_type, fileUrl]
      );

      // Log action
      await logAction({
        user_id,
        action: "UPLOAD_KYC_DOCUMENT",
        log_message: `Uploaded new KYC document: ${document_type}`,
        status: "SUCCESS",
        action_by: userEmail,
      });

      return res.status(201).json({
        status: true,
        message: `${document_type} uploaded successfully`,
        data: {
          url: fileUrl
        }
      });

    } catch (err) {
      console.error("Error uploading KYC document:", err);
      return res.status(500).json({ status: false, message: "Server error" });
    }
  }
];




exports.getCustomerKyc = async (req, res) => {
  const { user_id } = req.user || {}; // from middleware

  if (!user_id) {
    return res.status(400).json({
      status: false,
      message: "User ID is required",
    });
  }

  try {
    const [rows] = await pool.query(
      "SELECT * FROM customer_kyc WHERE user_id = ?",
      [user_id]
    );

    return res.status(200).json({
      status: true,
      message: "KYC records retrieved successfully",
      data: rows,
    });
  } catch (err) {
    console.error("Error retrieving customer KYC:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while retrieving KYC records",
    });
  }
};