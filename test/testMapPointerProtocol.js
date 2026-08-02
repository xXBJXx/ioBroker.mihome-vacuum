const assert = require('node:assert/strict');
const legacyProtocol = require('../lib/mapPointerProtocol');
const typedProtocol = require('../build/lib/mapPointerProtocol');

describe('Generic map-pointer protocol TypeScript migration', () => {
    it('preserves ready pointers with exactly three percent-separated parts', () => {
        const pointers = ['synthetic-host%synthetic-token%synthetic-file', 'a%%c'];

        for (const pointer of pointers) {
            const response = { result: [pointer] };
            assert.deepEqual(
                typedProtocol.parseMapPointerResponse(response),
                legacyProtocol.parseMapPointerResponse(response),
            );
            assert.deepEqual(typedProtocol.parseMapPointerResponse(response), { action: 'ready', pointer });
        }
    });

    it('preserves map-slot stop and all retry decisions', () => {
        const responses = [
            { result: ['map_slot_2'] },
            {},
            { result: null },
            { result: false },
            { result: ['retry'] },
            { result: ['a%b'] },
            { result: ['a%b%c%d'] },
            { result: 'unknown_method' },
        ];

        for (const response of responses) {
            assert.deepEqual(
                typedProtocol.parseMapPointerResponse(response),
                legacyProtocol.parseMapPointerResponse(response),
            );
        }
        assert.deepEqual(typedProtocol.parseMapPointerResponse(responses[0]), { action: 'stop' });
        assert.deepEqual(typedProtocol.parseMapPointerResponse(responses[4]), { action: 'retry' });
    });

    it('preserves errors for malformed truthy result containers', () => {
        const responses = [{ result: [] }, { result: [42] }, { result: {} }];

        for (const response of responses) {
            assert.throws(() => legacyProtocol.parseMapPointerResponse(response), TypeError);
            assert.throws(() => typedProtocol.parseMapPointerResponse(response), TypeError);
        }
    });
});
