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