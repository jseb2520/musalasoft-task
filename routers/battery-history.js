const router = require('express').Router();
const mysql = require('mysql2/promise');

const dbConfig = {
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_DATABASE,
};

// Route to get battery history for all drones
router.get('/', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
		// Get battery history for all drones from the battery_history table
		const [historyResult] = await connection.execute(
			'SELECT * FROM battery_history ORDER BY timestamp DESC'
		);
		const batteryHistory = historyResult;

		connection.end();

		if (batteryHistory.length === 0) {
			return res
				.status(404)
				.json({error: 'No battery history found for any drone.'});
		}

		return res.status(200).json(batteryHistory);
	} catch (error) {
		console.error('Error while getting battery history:', error);
		return res.status(500).json({error: 'Internal Server Error'});
	}
});


module.exports = router;