const chai = require('chai');
const chaiHttp = require('chai-http');
const app = require('../app');
const expect = chai.expect;

chai.use(chaiHttp);

describe('Drones API', () => {
	describe('POST /drones', () => {
		it('should register a new drone', (done) => {
			chai
				.request(app)
				.post('/drones')
				.send({
					serialNumber: 'TEST123',
					model: 'Middleweight',
					weightLimit: 200,
					batteryCapacity: 85,
                    status: "IDLE"
				})
				.end((err, res) => {
					expect(res).to.have.status(201);
					expect(res.body).to.be.an('object');
					expect(res.body).to.have.property('serialNumber', 'TEST123');
					expect(res.body).to.have.property('model', 'Middleweight');
					expect(res.body).to.have.property('weightLimit', 200);
					expect(res.body).to.have.property('batteryCapacity', 85);
					expect(res.body).to.have.property('state', 'IDLE');
					done();
				});
		});

	});

	// Test for the GET /drones endpoint
	describe('GET /drones', () => {
		it('should return an array of registered drones', (done) => {
			chai
				.request(app)
				.get('/drones')
				.end((err, res) => {
					expect(res).to.have.status(200);
					expect(res.body).to.be.an('array');
					done();
				});
		});

	});
});
