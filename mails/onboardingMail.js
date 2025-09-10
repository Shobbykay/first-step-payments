const year = new Date().getFullYear();

exports.register_confirm_email = (first_name, verification_link) => {
  const yearNow = new Date().getFullYear(); 

    return `Hello Kayode,<br><br>Your transaction PIN has been set successfully.<br><br>If you did not perform this action, please contact support immediately.<br><br>Best regards,<br><strong>First Step Payments Team</strong>`;
};