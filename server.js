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
const superadminRoutes = require('./routes/superadmin');

app.use('/api', helloRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/notification', notificationRoutes);
app.use('/api/v1/linked_accounts', linkedAccountsRoutes);
app.use('/api/v1/superadmin', superadminRoutes);


//superadmin routes



// Root
app.get('/', (req, res) => {
  res.send('Welcome to First Step Foreign Exchange Bureau API!');
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

