const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const cron = require('node-cron');

const app = express();
app.use(bodyParser.json());

const dbConfig = {
	host: 'mysql', // Since we will use Docker Compose, the hostname is the service name from the docker-compose.yml
	user: 'droneuser',
	password: 'dronepassword',
	database: 'dronedb',
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

// **************************** CREATE TABLES IF NOT EXIST *******************************

// Function to create the database tables if they do not exist
async function createTablesIfNotExist() {
	try {
		const connection = await mysql.createConnection(dbConfig);

		await connection.execute(`
      CREATE TABLE IF NOT EXISTS drones (
        id SERIAL PRIMARY KEY,
        serial_number VARCHAR(100) UNIQUE NOT NULL,
        model VARCHAR(100) NOT NULL,
        weight_limit INT NOT NULL,
        battery_capacity INT NOT NULL,
        state VARCHAR(20) NOT NULL
      )
    `);

		await connection.execute(`
      CREATE TABLE IF NOT EXISTS medications (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        weight INT NOT NULL,
        code VARCHAR(100) NOT NULL,
        image VARCHAR(200) NOT NULL,
        drone_serial_number VARCHAR(100) REFERENCES drones(serial_number) ON DELETE CASCADE
      )
    `);

		await connection.execute(`
      CREATE TABLE IF NOT EXISTS battery_history (
        id SERIAL PRIMARY KEY,
        serial_number VARCHAR(100) NOT NULL REFERENCES drones(serial_number) ON DELETE CASCADE,
        timestamp BIGINT NOT NULL,
        battery_capacity INT NOT NULL
      )
    `);

		console.log('Database tables are ready.');
		connection.end();
	} catch (error) {
		console.error('Error while creating database tables:', error);
		throw error;
	}
}

// Route to get all registered drones
app.get('/drones', async (req, res) => {
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
app.post('/drones', async (req, res) => {
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
app.post('/drones/:serialNumber/load', async (req, res) => {
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
app.get('/drones/:serialNumber/loaded-medications', async (req, res) => {
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
app.get('/drones/available', async (req, res) => {
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
app.get('/drones/:serialNumber/battery', async (req, res) => {
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

// Route to get battery history for all drones
app.get('/drones/battery-history', async (req, res) => {
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

// Route to get all medications
app.get('/medications', async (req, res) => {
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
app.post('/medications', async (req, res) => {
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

// Add a periodic task to check drones battery levels every 1 minute and create history/audit event log
/*
 			#  ┌──────────── minute
 			#  │ ┌────────── hour
 			#  │ │ ┌──────── day of month
 			#  │ │ │ ┌────── month
 			#  │ │ │ │ ┌──── day of week
 			#  │ │ │ │ │
			#  │ │ │ │ │
 			#  * * * * *
 */
cron.schedule('* * * * *', async () => {
	try {
		const connection = await mysql.createConnection(dbConfig);

		const dronesData = await connection.execute(
			'SELECT serial_number, battery_capacity FROM drones'
		);
		const batteryHistory = dronesData[0].map((drone) => ({
			serialNumber: drone.serial_number,
			timestamp: Date.now(),
			batteryCapacity: drone.battery_capacity,
		}));

		for (const entry of batteryHistory) {
			await connection.execute(
				'INSERT INTO battery_history(serial_number, timestamp, battery_capacity) VALUES(?, ?, ?)',
				[entry.serialNumber, entry.timestamp, entry.batteryCapacity]
			);
		}
	} catch (error) {
		console.error('Error while adding battery history:', error);
	}
});

// Start the server and create tables on startup
const port = process.env.PORT;
createTablesIfNotExist()
	.then(() => {
		app.listen(5000, () => {
			console.log(`Server is running on port ${port}`);
		});
	})
	.catch((error) => {
		console.error('Error while connecting to database:', error);
		process.exit(1);
	});
