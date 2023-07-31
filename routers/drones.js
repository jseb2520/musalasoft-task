const router = require('express').Router();
const mysql = require('mysql2/promise');

const dbConfig = {
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_DATABASE,
};

// Drone model validation
const validModels = [
	'Lightweight',
	'Middleweight',
	'Cruiserweight',
	'Heavyweight',
];

// Prevent the drone from being loaded with more weight than it can carry
function isOverweight(drone, loadedWeight) {
	return loadedWeight > drone.weight_limit;
}

// Prevent the drone from being in LOADING state if the battery level is below 25%
function isLowBattery(drone) {
	return drone.battery_capacity < 25;
}

// Route to get all registered drones
router.get('/', async (req, res) => {
	try {
        const connection = await mysql.createConnection(dbConfig);
		// Get all drones from the drones table
		const [dronesResult] = await connection.execute('SELECT * FROM drones');
		const drones = dronesResult;

		connection.end();

		if (drones.length === 0) {
			return res.status(404).json({error: 'No drones found.'});
		}

		return res.status(200).json(drones);
	} catch (error) {
		console.error('Error while getting drones:', error);
		return res.status(500).json({error: 'Internal Server Error'});
	}
});

// Route for registering a new drone
router.post('/', async (req, res) => {
	try {
        const connection = await mysql.createConnection(dbConfig);
		const {serialNumber, model, weightLimit, batteryCapacity, state} = req.body;

		// Input validation
		if (!serialNumber || !model || !weightLimit || !batteryCapacity) {
			return res.status(400).json({error: 'All fields are required.'});
		}

		if (serialNumber.length > 100) {
			return res
				.status(400)
				.json({error: 'Serial number must be 100 characters or less.'});
		}

		if (!validModels.includes(model)) {
			return res.status(400).json({error: 'Invalid drone model.'});
		}

		if (weightLimit > 500) {
			return res
				.status(400)
				.json({error: 'Weight limit cannot exceed 500 grams.'});
		}

		if (batteryCapacity < 0 || batteryCapacity > 100) {
			return res
				.status(400)
				.json({error: 'Battery capacity must be between 0 and 100.'});
		}

		// Save the drone data to database after registering a new drone
		await connection.execute(
			'INSERT INTO drones(serial_number, model, weight_limit, battery_capacity, state) VALUES(?, ?, ?, ?, ?)',
			[serialNumber, model, weightLimit, batteryCapacity, state]
		);

		connection.end();
		return res.status(201).json({
			serialNumber,
			model,
			weightLimit,
			batteryCapacity,
			state,
			loadedMedications: [],
		});
	} catch (error) {
		console.error('Error while registering a drone:', error);
		return res.status(500).json({error: 'Internal Server Error'});
	}
});

// Route for loading a drone with medication items
router.post('/:serialNumber/load', async (req, res) => {
	try {
        const connection = await mysql.createConnection(dbConfig);
		const {medications} = req.body;
		const {serialNumber} = req.params;

		const droneQuery = await connection.execute(
			'SELECT * FROM drones WHERE serial_number = ?',
			[serialNumber]
		);

		const drone = droneQuery[0][0];

		if (!drone) {
			return res.status(404).json({error: 'Drone not found.'});
		}

		if (drone.state !== 'IDLE') {
			return res
				.status(400)
				.json({error: 'Drone must be in IDLE state to load medications.'});
		}

		// Assume medications is an array of objects with name, weight, code, and image properties
		if (!Array.isArray(medications)) {
			return res
				.status(400)
				.json({error: 'Medications must be provided as an array.'});
		}

		for (const med of medications) {
			if (!med.name || !med.weight || !med.code || !med.image) {
				return res
					.status(400)
					.json({error: 'All medication fields are required.'});
			}

			// Medication weight validation
			if (isNaN(parseFloat(med.weight)) || med.weight <= 0) {
				return res
					.status(400)
					.json({error: 'Medication weight must be a positive number.'});
			}

			// Medication code validation
			if (!/^[A-Z0-9_]+$/.test(med.code)) {
				return res.status(400).json({error: 'Invalid medication code format.'});
			}
		}

		// Calculate total weight of loaded medications
		const loadedWeight = medications.reduce((acc, med) => acc + med.weight, 0);

		// Prevent the drone from being loaded with more weight than it can carry
		if (isOverweight(drone, loadedWeight)) {
			return res.status(400).json({error: 'Drone weight limit exceeded.'});
		}

		// Prevent the drone from being in LOADING state if the battery level is below 25%
		if (isLowBattery(drone)) {
			return res
				.status(400)
				.json({error: 'Drone battery level too low for loading.'});
		}

		// Save the loaded medications to database
		for (const med of medications) {
			await connection.execute(
				'INSERT INTO medications(name, weight, code, image, drone_serial_number) VALUES(?, ?, ?, ?, ?)',
				[med.name, med.weight, med.code, med.image, serialNumber]
			);
		}

		// Update the drone state in database
		await connection.execute(
			'UPDATE drones SET state = ? WHERE serial_number = ?',
			['LOADED', serialNumber]
		);

		connection.end();
		return res.status(200).json(medications);
	} catch (error) {
		console.error('Error while loading medications:', error);
		return res.status(500).json({error: 'Internal Server Error'});
	}
});

// Route for checking loaded medication items for a given drone
router.get('/:serialNumber/loaded-medications', async (req, res) => {
	try {
        const connection = await mysql.createConnection(dbConfig);
		const {serialNumber} = req.params;

		const droneQuery = await connection.execute(
			'SELECT * FROM drones WHERE serial_number = ?',
			[serialNumber]
		);
		const drone = droneQuery[0][0];

		if (!drone) {
			return res.status(404).json({error: 'Drone not found.'});
		}

		const medicationsQuery = await connection.execute(
			'SELECT * FROM medications WHERE drone_serial_number = ?',
			[serialNumber]
		);

		connection.end();
		return res.status(200).json(medicationsQuery[0]);
	} catch (error) {
		console.error('Error while retrieving loaded medications:', error);
		return res.status(500).json({error: 'Internal Server Error'});
	}
});

// Route for checking available drones for loading
router.get('/available', async (req, res) => {
	try {
        const connection = await mysql.createConnection(dbConfig);
		const availableDronesQuery = await connection.execute(
			'SELECT * FROM drones WHERE state = ?',
			['IDLE']
		);

		connection.end();
		return res.status(200).json(availableDronesQuery[0]);
	} catch (error) {
		console.error('Error while retrieving available drones:', error);
		return res.status(500).json({error: 'Internal Server Error'});
	}
});

// Route for checking drone battery level for a given drone
router.get('/:serialNumber/battery', async (req, res) => {
	try {
        const connection = await mysql.createConnection(dbConfig);
		const {serialNumber} = req.params;

		const [droneQuery] = await connection.execute(
			'SELECT * FROM drones WHERE serial_number = ?',
			[serialNumber]
		);
		const drone = droneQuery[0];

		if (drone.length === 0) {
			return res.status(404).json({error: 'Drone not found.'});
		}

		connection.end();
		return res.status(200).json({batteryCapacity: drone.battery_capacity});
	} catch (error) {
		console.error('Error while retrieving drone battery level:', error);
		return res.status(500).json({error: 'Internal Server Error'});
	}
});

module.exports = router;
