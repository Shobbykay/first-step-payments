const bcrypt = require("bcrypt");

exports.hashPassword = async(password) => {
    const saltRounds = 10; // cost factor, higher = slower but more secure
    return await bcrypt.hash(password, saltRounds);
};
