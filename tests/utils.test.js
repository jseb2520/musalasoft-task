const {calculateWeight} = require('../utils');
const expect = require('chai').expect;

describe('Utility Functions', () => {
	it('should calculate the total weight', () => {
		const items = [
			{name: 'Item A', weight: 100},
			{name: 'Item B', weight: 150},
			{name: 'Item C', weight: 80},
		];

		const totalWeight = calculateWeight(items);
		expect(totalWeight).to.equal(330);
	});

	// Add more tests for other utility functions
});
