const year = new Date().getFullYear();

exports.register_confirm_email = (first_name, verification_link) => {
  const yearNow = new Date().getFullYear(); 

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Verify Your Email</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* Import Plus Jakarta Sans */
    <!-- Google Fonts (works only in clients that support web fonts) -->
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">

    /* General reset for email */
    body, table, td, a {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    body {
      margin: 0;
      padding: 0;
      width: 100% !important;
      background-color: #f3f3f3;
      font-family: 'Plus Jakarta Sans', Arial, sans-serif;
    }
    a {
      text-decoration: none;
    }
    /* Responsive */
    @media only screen and (max-width: 600px) {
      .container {
        width: 100% !important;
        padding: 15px !important;
      }
      .button {
        width: 100% !important;
        display: block !important;
      }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f3f3f3;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center" bgcolor="#f3f3f3" style="padding: 20px;">
        <!-- Container -->
        <table class="container" border="0" cellpadding="0" cellspacing="0" width="600" 
               style="max-width:600px; background-color:#ffffff; border-radius:8px; overflow:hidden;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 30px 20px 10px;">
              <img src="https://cc.yetziratlabs.com.ng/faf_logo.png" alt="FSF Logo" width="120" style="display:block;">
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 20px; color:#333333; font-size:16px; line-height:24px;">
              <h2 style="margin:0; font-size:20px; font-weight:bold; color:#000;">Confirm your email address</h2>
              <p style="margin:20px 0 0;">Hi ${first_name},</p>
              <p style="margin:10px 0 0;">Thanks for signing up with FSF Wallet!</p>
              <p style="margin:10px 0 20px;">To secure your account and complete registration, please verify your email address.</p>
              <p style="margin:0; font-weight:bold;">Click the button below to verify:</p>

              <!-- Button -->
              <table border="0" cellspacing="0" cellpadding="0" style="margin:20px 0;">
                <tr>
                  <td align="center">
                    <a href="${verification_link}" 
                       class="button"
                       style="background-color:#e74c3c; color:#ffffff; padding:12px 30px; 
                              border-radius:6px; font-size:16px; font-weight:bold; display:inline-block;">
                      Verify My Email
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Info -->
              <p style="margin:0; font-size:14px; color:#666;">This link will expire in 24 hours for your security. If you didn’t sign up for an account, you can safely ignore this message.</p>
              <p style="margin:20px 0 0; font-size:14px; color:#666;">Need help? Contact our support team anytime.</p>
              <p style="margin:20px 0 0;">Thanks for choosing FSF Wallet,<br>The FSF Wallet Team</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" bgcolor="#ffffff" style="padding: 20px; border-top:1px solid #ddd;">
              <!-- Socials -->
              <p style="margin:0;">
                <a href="#" style="margin:0 8px;"><img src="https://cdn-icons-png.flaticon.com/24/733/733547.png" width="20"></a>
                <a href="#" style="margin:0 8px;"><img src="https://cdn-icons-png.flaticon.com/24/733/733579.png" width="20"></a>
                <a href="#" style="margin:0 8px;"><img src="https://cdn-icons-png.flaticon.com/24/733/733558.png" width="20"></a>
              </p>
              <!-- App buttons -->
              <p style="margin:15px 0;">
                <a href="#"><img src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg" width="130"></a>
                <a href="#"><img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" width="130"></a>
              </p>
              <!-- Address -->
              <p style="margin:10px 0 0; font-size:12px; color:#777;">
                &copy; ${yearNow} First Step Financial Services<br>
                NP House 2ND Floor Walpole Street, Freetown, Sierra Leone
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};