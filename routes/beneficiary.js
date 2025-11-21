const express = require('express');
const router = express.Router();
const { listAccountBeneficiaries, deleteBeneficiary } = require('../controllers/BeneficiaryController');
const auth = require("../middleware/userAuth");

router.get('/list', auth, listAccountBeneficiaries);
router.post('/delete', auth, deleteBeneficiary);

module.exports = router;