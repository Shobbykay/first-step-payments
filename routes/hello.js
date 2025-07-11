const express = require('express');
const router = express.Router();
const { sayHello } = require('../controllers/helloController');

router.get('/hello', sayHello);

module.exports = router;