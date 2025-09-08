const nodemailer = require("nodemailer");

// configure transporter (use your SMTP credentials, e.g. Gmail, SendGrid, Mailgun)
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,   // e.g. "smtp.gmail.com"
  port: process.env.MAIL_PORT,   // e.g. 465 for SSL or 587 for TLS
  secure: process.env.MAIL_SECURE === "false", // true for 465, false for 587
  auth: {
    user: process.env.MAIL_USER, 
    pass: process.env.MAIL_PASS
  },
  tls: {
    rejectUnauthorized: false, // ignore cert issues
  },
});

exports.sendMail = async (to, subject, html) => {
  try {
    
    await transporter.sendMail({
      from: `"First Step Payments" <${process.env.MAIL_USER}>`,
      to,
      subject,
      html
    });
    console.log("Email sent to", to);
  } catch (err) {
    console.error("Error sending email:", err);
  }
};


// `<p>Dear user,</p>
//         <p>Your transaction PIN has been set successfully. If this wasn’t you, please contact support immediately.</p>
//         <br>
//         <p>Best Regards,<br>First Step Payments Team</p>`
