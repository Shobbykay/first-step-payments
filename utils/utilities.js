const bcrypt = require("bcrypt");
const crypto = require('crypto');

exports.hashPassword = async(password) => {
    const saltRounds = 10; // cost factor, higher = slower but more secure
    return await bcrypt.hash(password, saltRounds);
};


exports.sha1Hex = async(text) => {
    return crypto.createHash('sha1').update(text, 'utf8').digest('hex');
};


exports.generateRandomString = (length = 7) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const used = new Set();

  while (result.length < length) {
    const randomChar = chars.charAt(Math.floor(Math.random() * chars.length));
    if (!used.has(randomChar)) {
      result += randomChar;
      used.add(randomChar);
    }
  }

  return result;
}


exports.generateAgentId = async() => {
    const now = new Date();
    const seconds = String(now.getSeconds()).padStart(2, "0");

    const str = 'AGR-' + this.generateRandomString() + seconds;
    return str;
}

exports.generatePickupId = async() => {
  const random = Math.floor(1000000000 + Math.random() * 9000000000);
  return `FSF-${random}`;
}


exports.generatePickupTransactionId = async() => {
  const now = new Date();

  const yyyy = now.getFullYear().toString();
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const dd = now.getDate().toString().padStart(2, "0");
  const hh = now.getHours().toString().padStart(2, "0");
  const min = now.getMinutes().toString().padStart(2, "0");
  const ss = now.getSeconds().toString().padStart(2, "0");

  const timestamp = `${yyyy}${mm}${dd}${hh}${min}${ss}`;

  // Generate 3-digit random number (000-999)
  const randomThree = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");

  return `FSF-${timestamp}${randomThree}`;
}


exports.allowedAdminRoles = () => {
  return [
    "ADMINISTRATOR",
    "CUSTOMER_SUPPORT",
    "FINANCE_OFFICER",
    "COMPLIANCE",
  ];
};