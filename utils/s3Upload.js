// utils/s3Upload.js
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const s3 = require("./s3");

const uploadToS3Buffer = async (buffer, key, mimetype) => {
  try {
    const bucketName = process.env.AWS_S3_BUCKET;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: mimetype
    });

    await s3.send(command);

    return `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  } catch (err) {
    console.error("S3 upload error:", err);
    throw new Error("Failed to upload file to S3");
  }
};

module.exports = uploadToS3Buffer;
