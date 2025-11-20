require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// suppress punycode warning
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (!warning.message.includes("punycode")) {
    console.warn(warning.name, warning.message);
  }
});


// 🔌 Connect to MySQL using env variables
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});


// Routes
const helloRoutes = require('./routes/hello');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const linkedAccountsRoutes = require('./routes/linked_accounts');
const notificationRoutes = require('./routes/notification');
const ticketsRoutes = require('./routes/tickets');
const settingsRoutes = require('./routes/settings');
const kycRoutes = require('./routes/kyc');
const nearbyAgentsRoutes = require('./routes/nearby_agent');
const twofaRoutes = require('./routes/2fa');
const pickupRoutes = require('./routes/pickup');
const superadminRoutes = require('./routes/superadmin');

app.use('/api', helloRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/notification', notificationRoutes);
app.use('/api/v1/linked_accounts', linkedAccountsRoutes);
app.use('/api/v1/tickets', ticketsRoutes);
app.use('/api/v1/kyc', kycRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/nearby_agents', nearbyAgentsRoutes);
app.use('/api/v1/2fa', twofaRoutes);
app.use('/api/v1/pickup', pickupRoutes);
app.use('/api/v1/superadmin', superadminRoutes);


//health-check route
app.get("/api/v1/health-check", async (req, res) => {
  const healthStatus = {
    status: true,
    message: "Server is healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: {
      database: "pending"
    }
  };

  try {
    // Check database connectivity
    await pool.query("SELECT 1");
    healthStatus.checks.database = "connected";
  } catch (error) {
    healthStatus.status = false;
    healthStatus.message = "One or more services are unhealthy";
    healthStatus.checks.database = "disconnected";
    healthStatus.error = error.message;
    return res.status(500).json(healthStatus);
  }

  res.status(200).json(healthStatus);
});


// Root
app.get('/', (req, res) => {
  res.send('Welcome to First Step Foreign Exchange Bureau API!');
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

