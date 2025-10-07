const express = require('express');
const router = express.Router();
const { login, forgot, reset, confirmResetToken, logoutAdmin } = require('../controllers/superadmin/loginController');
const { fetchLogs, fetchSingleLog } = require('../controllers/superadmin/logController');
const { fetchAllCustomers, fetchSingleCustomer, fetchSuspendedCustomers, fetchArchiveCustomers, suspendCustomer, closeCustomer, deleteCustomer, restoreCustomer, reinstateCustomer, updateCustomer, changeUserPassword } = require('../controllers/superadmin/customerController');
const { fetchAllAgents, updateAgent, reinstateAgent, changeAgentPassword, fetchSingleAgent, fetchSuspendedAgents, fetchArchiveAgents, suspendAgent, closeAgent, deleteAgent, restoreAgent } = require('../controllers/superadmin/AgentController');
const { addAdminUser, adminListOtps, addPassword, verifyAdminOtp, deactivateAdmin, reactivateAdmin, changeRole, listAdminUsers, updateProfileImage, updateName, changePassword } = require('../controllers/superadmin/adminController');
const { createPrefunding, listPrefunding } = require('../controllers/superadmin/PrefundController');
const { transferRate, fxRate, transfersService, getAgentCommissionFees, updateAgentCommissionFee } = require('../controllers/superadmin/FeesController');
const { fetchCustomersKYC, fetchAgentsKYC, approveCustomerKYC, approveAgentKYC, rejectAgentKYC } = require('../controllers/superadmin/KycController');
const { fetchTickets, fetchSingleTicket, changeTicketStatus } = require('../controllers/superadmin/TicketController');
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
router.get('/list_user_roles', listAdminUsers);
router.post('/update/profile_picture', auth, updateProfileImage);
router.post('/update/name', auth, updateName);
router.post('/update/password', auth, changePassword);



//customer
router.get('/customer/all', auth, fetchAllCustomers);
router.get('/customer/:user_id', auth, fetchSingleCustomer);
router.get('/customer/suspend/all', auth, fetchSuspendedCustomers);
router.get('/customer/archive/all', auth, fetchArchiveCustomers);
router.post('/customer/suspend/:user_id', auth, suspendCustomer);
router.post('/customer/close/:user_id', auth, closeCustomer);
router.post('/customer/delete/:user_id', auth, deleteCustomer);
router.post('/customer/restore/:user_id', auth, restoreCustomer);
router.post('/customer/reinstate/:user_id', auth, reinstateCustomer);
router.post('/customer/update/:user_id', auth, updateCustomer);
router.post('/customer/password/:user_id', auth, changeUserPassword);




//agent
router.get('/agent/all', auth, fetchAllAgents);
router.get('/agent/:user_id', auth, fetchSingleAgent);
router.get('/agent/suspend/all', auth, fetchSuspendedAgents);
router.get('/agent/archive/all', auth, fetchArchiveAgents);
router.post('/agent/suspend/:user_id', auth, suspendAgent);
router.post('/agent/close/:user_id', auth, closeAgent);
router.post('/agent/delete/:user_id', auth, deleteAgent);
router.post('/agent/restore/:user_id', auth, restoreAgent);
router.post('/agent/password/:user_id', auth, changeAgentPassword);
router.post('/agent/update/:user_id', auth, updateAgent);
router.post('/agent/reinstate/:user_id', auth, reinstateAgent);



// Agent Prefunding
router.post('/agent/prefund', auth, createPrefunding);
router.get('/agent/prefund/list', auth, listPrefunding);




// Fees & Charges
router.get('/fees/rates', auth, transferRate);
router.get('/fees/fxrates', auth, fxRate);
router.get('/fees/transfer_service', auth, transfersService);
router.get('/fees/agent/commission_fee', auth, getAgentCommissionFees);
router.post('/fees/agent/commission_fee/:id', auth, updateAgentCommissionFee);




// kyc
router.get('/kyc/customer', auth, fetchCustomersKYC);
router.get('/kyc/agents', auth, fetchAgentsKYC);
router.post('/kyc/customer/approve', auth, approveCustomerKYC);
router.post('/kyc/agent/approve', auth, approveAgentKYC);
router.post('/kyc/agent/reject', auth, rejectAgentKYC);




//logs
router.get('/logs/all', auth, fetchLogs);
router.get('/logs/single/:id', auth, fetchSingleLog);





//tickets
router.get('/tickets/all', auth, fetchTickets);
router.get('/tickets/single/:ticket_id', auth, fetchSingleTicket);
router.post('/tickets/:ticket_id/status', auth, changeTicketStatus);

module.exports = router;