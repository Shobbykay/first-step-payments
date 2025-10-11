const { PutObjectCommand } = require("@aws-sdk/client-s3");
const pool = require('../services/db');
const s3 = require("../utils/s3");

const bucketName = process.env.AWS_S3_BUCKET;

const uploadToS3 = async (file, folder) => {
  const key = `${folder}/${Date.now()}-${file.originalname}`;
  const params = {
    Bucket: bucketName,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  };
  await s3.send(new PutObjectCommand(params));
  return `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};



exports.BecomeAgent = async (req, res) => {
  try {
    const { email_address, business_name, business_address, location, business_hours } = req.body;

    // Validate required fields
    if (!email_address || !business_name || !business_address || !location || !business_hours) {
      return res.status(400).json({ status: false, message: "Missing required fields" });
    }

    // Check if user exists
    const [userRows] = await pool.query(
      `SELECT user_id 
       FROM users_account 
       WHERE email_address = ? 
       LIMIT 1`,
      [email_address]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ status: false, message: "User does not exist" });
    }

    // Parse business_hours JSON
    let hours;
    try {
      hours = JSON.parse(business_hours);
    } catch (err) {
      return res.status(400).json({ status: false, message: "Invalid business_hours JSON expected" });
    }

    // Check if user already submitted agent application
    const [existing] = await pool.query(
      `SELECT email_address FROM become_an_agent WHERE email_address = ? LIMIT 1`,
      [email_address]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        status: false,
        message: "Agent application already submitted for this user",
      });
    }

    // Upload business license (required)
    if (!req.files["business_license"]) {
      return res.status(400).json({
        status: false,
        message: "Business license document is required",
      });
    }

    const business_license = await uploadToS3(req.files["business_license"][0], "business_license");

    // Insert into become_an_agent table
    await pool.query(
      `INSERT INTO become_an_agent 
        (email_address, business_name, business_address, location, business_hours, business_license)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        email_address,
        business_name,
        business_address,
        location,
        JSON.stringify(hours),
        business_license
      ]
    );

    // Respond success
    return res.json({
      success: true,
      message: "Agent application submitted successfully",
      data: {
        business_name,
        business_address,
        location,
        business_hours: hours.businessHours,
        documents: {
          business_license
        }
      }
    });

  } catch (err) {
    console.error("Error submitting agent application:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};









exports.BecomeAgentOld = async (req, res) => {
  try {
    const { email_address, business_name, business_address, location, business_hours } = req.body;

    // Validate required fields
    if (!email_address || !business_name || !business_address || !location || !business_hours) {
      return res.status(400).json({ status: false, message: "Missing required fields" });
    }

    // check if email address exist for DB
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

    // Parse business_hours JSON
    let hours;
    try {
      hours = JSON.parse(business_hours);
    } catch (err) {
      return res.status(400).json({ status: false, message: "Invalid business_hours JSON expected" });
    }

    const uploadedFiles = {};

    if (req.files["government_id"]) {
      uploadedFiles.government_id = await uploadToS3(req.files["government_id"][0], "government_id");
    }
    if (req.files["utility_bill"]) {
      uploadedFiles.utility_bill = await uploadToS3(req.files["utility_bill"][0], "utility_bill");
    }
    if (req.files["passport_photo"]) {
      uploadedFiles.passport_photo = await uploadToS3(req.files["passport_photo"][0], "passport_photo");
    }

    await pool.query(
    `INSERT INTO agents_documents 
    (email_address, business_name, business_address, location, business_hours, government_id, utility_bill, passport_photo) 
    VALUES (?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE 
        business_name = VALUES(business_name),
        business_address = VALUES(business_address),
        location = VALUES(location),
        business_hours = VALUES(business_hours),
        government_id = VALUES(government_id),
        utility_bill = VALUES(utility_bill),
        passport_photo = VALUES(passport_photo)`,
    [
        email_address,
        business_name,
        business_address,
        location,
        JSON.stringify(hours),
        uploadedFiles.government_id,
        uploadedFiles.utility_bill,
        uploadedFiles.passport_photo
    ]);


    // Change ACCOUNT TYPE to AGENT after approval and send MAIL

    return res.json({
      success: true,
      message: "Agent application submitted",
      data: {
        business_name,
        business_address,
        location,
        business_hours: hours.businessHours,
        documents: uploadedFiles
      }
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};