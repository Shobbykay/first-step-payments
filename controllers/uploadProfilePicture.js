// for user accounts

const multer = require("multer");
const path = require("path");
const pool = require('../services/db');
const { v4: uuidv4 } = require("uuid");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

// Configure S3 client
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Multer config
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    console.log(extname, mimetype);
    console.log(file.mimetype, path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only JPG and PNG images are allowed"));
    }
  },
});

// Controller
exports.uploadProfilePicture = [
  upload.single("profile_image"), // form-data key
  async (req, res) => {
    try {
      const { email_address } = req.body;

      if (!req.file) {
        return res.status(400).json({ status: false, message: "No file uploaded" });
      }

      if (!email_address) {
        return res.status(400).json({ status: false, message: "Email Address is required" });
      }

      const [rows_] = await pool.query(
            `SELECT user_id 
             FROM users_account 
             WHERE email_address = ? 
             LIMIT 1`,
            [email_address]
        );
        if (rows_.length === 0) {
            return res.status(404).json({ status: false, message: "User does not exist" });
        }

      // Generate unique filename
      const fileExt = path.extname(req.file.originalname);
      const fileName = `profiles/${uuidv4()}${fileExt}`;

      // Upload to S3
      const command = new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        // ACL: "public-read", // Make file public (optional)
      });

      await s3.send(command);

      // Construct file URL (for public-read buckets)
      const fileUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

      // Update DB
      await pool.query(
        "UPDATE users_account SET profile_img = ? WHERE email_address = ?",
        [fileUrl, email_address]
      );

      return res.json({
        status: true,
        message: "Profile picture uploaded successfully",
        data: { profile_image: fileUrl },
      });

    } catch (err) {
      console.error(err);
      return res.status(500).json({
        status: false,
        message: err.message || "Server error",
      });
    }
  },
];
