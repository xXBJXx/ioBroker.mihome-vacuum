const assert = require('node:assert/strict');
const legacyProtocol = require('../lib/roomMappingProtocol');
const typedProtocol = require('../build/lib/roomMappingProtocol');

describe('Generic room-mapping protocol TypeScript migration', () => {
    it('preserves non-empty room arrays and their original reference', () => {
        const rooms = [[16, 'Living room'], [17, 'Kitchen']];
        const response = { result: rooms };
        const legacy = legacyProtocol.parseRoomMapping(response);
        const typed = typedProtocol.parseRoomMapping(response);

        assert.deepEqual(typed, legacy);
        assert.equal(typed, rooms);
    });

    it('preserves unsupported empty, missing, null, and unknown-method responses', () => {
        const responses = [{ result: [] }, {}, { result: null }, { result: false }, { result: 'unknown_method' }];

        for (const response of responses) {
            assert.equal(typedProtocol.parseRoomMapping(response), legacyProtocol.parseRoomMapping(response));
            assert.equal(typedProtocol.parseRoomMapping(response), null);
        }
    });

    it('preserves historical acceptance of other truthy values with a length', () => {
        const responses = [
            { result: 'synthetic-room-map' },
            { result: { 0: [16, 'Living room'], length: 1 } },
        ];

        for (const response of responses) {
            assert.equal(typedProtocol.parseRoomMapping(response), legacyProtocol.parseRoomMapping(response));
            assert.equal(typedProtocol.parseRoomMapping(response), response.result);
        }
        assert.equal(typedProtocol.parseRoomMapping({ result: 42 }), null);
    });
});
