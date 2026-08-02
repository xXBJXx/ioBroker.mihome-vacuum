const assert = require('node:assert/strict');
const legacyPayloads = require('../lib/vacuumCommandPayloads');
const typedPayloads = require('../build/lib/vacuumCommandPayloads');

describe('Generic vacuum command-payload TypeScript migration', () => {
    it('preserves valid integer, decimal, whitespace, and hexadecimal go-to parsing', () => {
        const values = ['1234,5678', ' 1234 , 5678 ', '1234.9,5678.2', '0x10,020'];

        for (const value of values) {
            assert.deepEqual(typedPayloads.parseGoToCoordinates(value), legacyPayloads.parseGoToCoordinates(value));
        }
        assert.deepEqual(typedPayloads.parseGoToCoordinates('1234.9,5678.2'), {
            coordinates: [1234, 5678],
            error: null,
        });
    });

    it('preserves argument-count and numeric validation errors', () => {
        const values = ['', '1234', '1,2,3', 'x,2', '1,NaN'];

        for (const value of values) {
            assert.deepEqual(typedPayloads.parseGoToCoordinates(value), legacyPayloads.parseGoToCoordinates(value));
        }
        assert.equal(typedPayloads.parseGoToCoordinates('1234').error, 'argument_count');
        assert.equal(typedPayloads.parseGoToCoordinates('x,2').error, 'invalid_coordinate');
    });

    it('preserves the nested app_rc_move payload and unknown value types', () => {
        const scenarios = [
            { velocity: 0.3, angularVelocity: -0.4, duration: 1500, sequenceNumber: 17 },
            { velocity: '0.3', angularVelocity: null, duration: undefined, sequenceNumber: '17' },
        ];

        for (const params of scenarios) {
            assert.deepEqual(typedPayloads.createRemoteMovePayload(params), legacyPayloads.createRemoteMovePayload(params));
        }
        assert.deepEqual(typedPayloads.createRemoteMovePayload(scenarios[0]), [
            [{ omega: -0.4, velocity: 0.3, seqnum: 17, duration: 1500 }],
        ]);
    });
});
