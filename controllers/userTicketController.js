// for user accounts

const multer = require("multer");
const path = require("path");
const pool = require('../services/db');
const { v4: uuidv4 } = require("uuid");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const logAction = require("../utils/logger");

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
    // const filetypes = /jpeg|jpg|png/;
    const filetypes = /\.(jpeg|jpg|png)$/i;
    const ext = path.extname(file.originalname).toLowerCase();
    const mimetype = file.mimetype;

    const extnameValid = filetypes.test(ext);
    const mimetypeValid = filetypes.test(mimetype) || mimetype === 'application/octet-stream';

    console.log("Extension valid:", extnameValid);
    console.log("MIME valid:", mimetypeValid, "| mimetype:", mimetype, "| ext:", ext);

    if (extnameValid || mimetypeValid) {// &&
      cb(null, true);
    } else {
      cb(new Error("Only JPG and PNG images are allowed"));
    }
  },
});




// Controller
exports.createTicket = [
  upload.single("ticket_image"), // form-data key
  async (req, res) => {
    try {

      const { user_id } = req.user || {};
      const { subject, category, description } = req.body;
      let email = '';


      //get email address
      const [rows__] = await pool.query(
        "SELECT email_address FROM users_account WHERE user_id = ? LIMIT 1",
        [user_id]
      );
  
      if (rows__.length === 0) {
        return res.status(401).json({ status: false, message: "Invalid user account" });
      }

      email = rows__[0].email_address;

      if (!email) {
        return res.status(400).json({
          status: false,
          message: "Missing user credentials",
        });
      }


      if (!subject || !category || !description) {
        return res.status(400).json({
          status: false,
          message: "subject, category, and description are required",
        });
      }



      // Prevent duplicate (same email, subject, category, and OPEN ticket)
      const [existing] = await pool.query(
        "SELECT ticket_id FROM tickets WHERE email_address = ? AND subject = ? AND category = ? AND status = 'OPEN' LIMIT 1",
        [email, subject, category]
      );

      if (existing.length > 0) {
        return res.status(400).json({
          status: false,
          message: "A similar open ticket already exists",
        });
      }



      // Handle image (optional)
    let imageUrl = null;
      if (req.file) {
        const allowedTypes = ["image/jpeg", "image/png"];
        if (!allowedTypes.includes(req.file.mimetype)) {
          return res.status(400).json({
            status: false,
            message: "Only JPG and PNG images are allowed",
          });
        }

        // Max 4MB
        if (req.file.size > 4 * 1024 * 1024) {
          return res.status(400).json({
            status: false,
            message: "Image size must not exceed 4MB",
          });
        }

        // Generate unique key
        const ext = req.file.originalname.split(".").pop();
        const fileKey = `tickets/${uuidv4()}.${ext}`;

        // Upload to S3
        const uploadParams = {
          Bucket: process.env.AWS_S3_BUCKET,
          Key: fileKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
          // ACL: "public-read",
        };

        await s3.send(new PutObjectCommand(uploadParams));

        imageUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
      }


      // Create ticket
      const ticket_id = uuidv4();
      await pool.query(
        `INSERT INTO tickets (ticket_id, email_address, subject, category, description, image_url)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [ticket_id, email, subject, category, description, imageUrl]
      );

      // Log action
      await logAction({
        user_id: req.user?.user_id || null,
        action: "CREATE_TICKET",
        log_message: `New ticket created (${ticket_id}) by user ${email}`,
        status: "SUCCESS",
        action_by: user_id,
      });

      return res.status(201).json({
        status: true,
        message: "Ticket created successfully",
        data: {
          ticket_id,
          email_address: email,
          subject,
          category,
          description,
          image_url: imageUrl,
          status: "OPEN",
        },
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
