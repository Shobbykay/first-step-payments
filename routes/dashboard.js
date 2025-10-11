const express = require('express');
const router = express.Router();
const { createTransactionPin } = require('../controllers/dashboardController');
const { uploadProfilePicture } = require('../controllers/uploadProfilePicture');
const { BecomeAgent, BecomeAgentOld } = require('../controllers/BecomeAgent');
const upload = require('../utils/upload');
const auth = require("../middleware/userAuth");

router.post('/create_pin', createTransactionPin);
router.post('/upload_profile_picture', auth, uploadProfilePicture);
router.post(
  "/become_an_agent",
  auth,
  upload.fields([
    { name: "business_license", maxCount: 1 },
  ]),
  BecomeAgent
);

router.post(
  "/become_an_agent_old",
  auth,
  upload.fields([
    { name: "government_id", maxCount: 1 },
    { name: "utility_bill", maxCount: 1 },
    { name: "passport_photo", maxCount: 1 }
  ]),
  BecomeAgentOld
);

module.exports = router;