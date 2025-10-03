const express = require('express');
const router = express.Router();
const { uploadKycDocuments, getCustomerKyc } = require('../controllers/KycCustomerController');
const auth = require("../middleware/userAuth");

router.post('/upload', auth, uploadKycDocuments);
router.get('/check', auth, getCustomerKyc);



module.exports = router;