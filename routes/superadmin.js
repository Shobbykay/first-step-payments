const express = require('express');
const router = express.Router();
const { login, forgot, reset, confirmResetToken, logoutAdmin } = require('../controllers/superadmin/loginController');
const { fetchLogs, fetchSingleLog } = require('../controllers/superadmin/logController');
const { fetchAllCustomers, fetchSingleCustomer, fetchSuspendedCustomers, fetchArchiveCustomers, suspendCustomer, closeCustomer, deleteCustomer, restoreCustomer, updateCustomer, changeUserPassword } = require('../controllers/superadmin/customerController');
const { fetchAllAgents, updateAgent, changeAgentPassword, fetchSingleAgent, fetchSuspendedAgents, fetchArchiveAgents, suspendAgent, closeAgent, deleteAgent, restoreAgent } = require('../controllers/superadmin/AgentController');
const { addAdminUser, adminListOtps, addPassword, verifyAdminOtp, deactivateAdmin, reactivateAdmin, changeRole } = require('../controllers/superadmin/adminController');
const auth = require("../middleware/auth");

//auth
router.post('/auth/login', login);
router.post('/auth/forgot', forgot);
router.post('/auth/confirm_reset_token', confirmResetToken);
router.post('/auth/reset', reset);

router.post('/auth/logout', logoutAdmin);



//access roles
router.post('/add_account', addAdminUser);
router.get('/otps', adminListOtps);
router.post('/add_password', addPassword);
router.get('/verify_otp/:otp', verifyAdminOtp);
router.post('/deactivate', deactivateAdmin);
router.post('/reactivate', reactivateAdmin);
router.post('/change_role', changeRole);



//customer
router.get('/customer/all', auth, fetchAllCustomers);
router.get('/customer/:user_id', auth, fetchSingleCustomer);
router.get('/customer/suspend/all', auth, fetchSuspendedCustomers);
router.get('/customer/archive/all', auth, fetchArchiveCustomers);
router.post('/customer/suspend/:user_id', auth, suspendCustomer);
router.post('/customer/close/:user_id', auth, closeCustomer);
router.get('/customer/delete/:user_id', auth, deleteCustomer);
router.get('/customer/restore/:user_id', auth, restoreCustomer);
router.post('/customer/update/:user_id', auth, updateCustomer);
router.post('/customer/password/:user_id', auth, changeUserPassword);




//agent
router.get('/agent/all', auth, fetchAllAgents);
router.get('/agent/:user_id', auth, fetchSingleAgent);
router.get('/agent/suspend/all', auth, fetchSuspendedAgents);
router.get('/agent/archive/all', auth, fetchArchiveAgents);
router.post('/agent/suspend/:user_id', auth, suspendAgent);
router.post('/agent/close/:user_id', auth, closeAgent);
router.get('/agent/delete/:user_id', auth, deleteAgent);
router.get('/agent/restore/:user_id', auth, restoreAgent);
router.post('/agent/password/:user_id', auth, changeAgentPassword);
router.post('/agent/update/:user_id', auth, updateAgent);


//logs
router.get('/logs/all', auth, fetchLogs);
router.get('/logs/single/:id', auth, fetchSingleLog);

module.exports = router;