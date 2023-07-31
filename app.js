const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const cron = require('node-cron');

// routers
const dronesRouter = require('./routers/drones');
const medicationsRouter = require('./routers/medications');
const batteryHistoryRouter = require('./routers/battery-history');

const app = express();

const dbConfig = {
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_DATABASE,
};

// **************************** MIDDLEWARES *******************************

app.use(bodyParser.json());
app.use('/drones', dronesRouter);
app.use('/medications', medicationsRouter);
app.use('/battery-history', batteryHistoryRouter);

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
		app.listen(port, () => {
			console.log(`Server is running on port ${port}`);
		});
	})
	.catch((error) => {
		console.error('Error while connecting to database:', error);
		process.exit(1);
	});
