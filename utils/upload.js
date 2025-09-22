const multer = require("multer");

// Memory storage (buffer upload to S3)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error("Only JPG, PNG, and PDF files are allowed"), false);
  }
  if (file.size > 5 * 1024 * 1024) { // 5MB
    return cb(new Error("File size exceeds 5MB"));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter
});

module.exports = upload;
