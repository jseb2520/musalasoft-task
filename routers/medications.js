const router = require('express').Router();
const mysql = require('mysql2/promise');

const dbConfig = {
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_DATABASE,
};

// Route to get all medications
router.get('/', async (req, res) => {
	try {
		const connection = await mysql.createConnection(dbConfig);
		// Get all medications from the medications table
		const [medicationsResult] = await connection.execute(
			'SELECT * FROM medications'
		);
		const medications = medicationsResult;

		connection.end();

		if (medications.length === 0) {
			return res.status(404).json({error: 'No medications found.'});
		}

		return res.status(200).json(medications);
	} catch (error) {
		console.error('Error while getting medications:', error);
		return res.status(500).json({error: 'Internal Server Error'});
	}
});

// Route for creating a new medication for a specific drone
router.post('/', async (req, res) => {
	try {
		const connection = await mysql.createConnection(dbConfig);

		const {name, weight, code, image, droneSerialNumber} = req.body;

		// Input validation
		if (!name || !weight || !code || !image || !droneSerialNumber) {
			return res.status(400).json({error: 'All fields are required.'});
		}

		// Medication weight validation
		if (isNaN(parseFloat(weight)) || weight <= 0) {
			return res
				.status(400)
				.json({error: 'Medication weight must be a positive number.'});
		}

		// Medication code validation
		if (!/^[A-Z0-9_]+$/.test(code)) {
			return res.status(400).json({error: 'Invalid medication code format.'});
		}

		// Check if the drone exists
		const [droneQuery] = await connection.execute(
			'SELECT * FROM drones WHERE serial_number = ?',
			[droneSerialNumber]
		);
		const drone = droneQuery[0];

		if (!drone) {
			return res.status(404).json({error: 'Drone not found.'});
		}

		// Save the medication data to database and associate it with the drone
		await connection.execute(
			'INSERT INTO medications(name, weight, code, image, drone_serial_number) VALUES(?, ?, ?, ?, ?)',
			[name, weight, code, image, droneSerialNumber]
		);
		connection.end();
		return res.status(201).json({name, weight, code, image, droneSerialNumber});
	} catch (error) {
		console.error('Error while creating a new medication:', error);
		return res.status(500).json({error: 'Internal Server Error'});
	}
});

module.exports = router;
