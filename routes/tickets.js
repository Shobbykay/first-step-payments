const express = require('express');
const router = express.Router();
const { createTicket } = require('../controllers/userTicketController');
const auth = require("../middleware/userAuth");

router.post('/create', auth, createTicket);

module.exports = router;