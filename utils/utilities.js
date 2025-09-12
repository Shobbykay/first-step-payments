const bcrypt = require("bcrypt");
const crypto = require('crypto');

exports.hashPassword = async(password) => {
    const saltRounds = 10; // cost factor, higher = slower but more secure
    return await bcrypt.hash(password, saltRounds);
};


exports.sha1Hex = async(text) => {
    return crypto.createHash('sha1').update(text, 'utf8').digest('hex');
};