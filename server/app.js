const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
const transactionRoutes = require('./routes/transactions');
const categoryRoutes = require('./routes/categories');

app.use('/api/transactions', transactionRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/summary', require('./routes/summary'));
app.use('/api/analysis', require('./routes/analysis'));
app.use('/api/fixed_costs', require('./routes/fixed_costs'));
app.use('/api/import', require('./routes/import'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Household Account App API is running' });
});



// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
