const assert = require('node:assert/strict');
const legacyProtocol = require('../lib/multiMapProtocol');
const typedProtocol = require('../build/lib/multiMapProtocol');

describe('Generic multi-map protocol TypeScript migration', () => {
    it('preserves map metadata and creates state labels for named and unnamed maps', () => {
        /** @type {import('../src/types/multiMapProtocol').MultiMapResponse} */
        const response = {
            result: [
                {
                    map_info: [
                        { mapFlag: 0, name: 'Ground floor', extra: 'preserved' },
                        { mapFlag: 7, name: '' },
                        { mapFlag: 'backup', name: 'Backup map' },
                    ],
                },
            ],
        };

        const legacy = legacyProtocol.parseMultiMapList(response);
        const typed = typedProtocol.parseMultiMapList(response);

        assert.deepEqual(typed, legacy);
        assert.ok(typed);
        assert.equal(typed.maps[0].extra, 'preserved');
        assert.deepEqual(typed.states, {
            0: 'Ground floor',
            7: '7',
            backup: 'Backup map',
        });
    });

    it('preserves empty lists and unsupported or missing results', () => {
        /** @type {import('../src/types/multiMapProtocol').MultiMapResponse[]} */
        const responses = [{ result: [{ map_info: [] }] }, { result: 'unknown_method' }, {}, { result: null }];

        for (const response of responses) {
            assert.deepEqual(typedProtocol.parseMultiMapList(response), legacyProtocol.parseMultiMapList(response));
        }
        assert.deepEqual(typedProtocol.parseMultiMapList(responses[0]), { maps: [], states: {} });
        assert.equal(typedProtocol.parseMultiMapList(responses[1]), null);
    });

    it('preserves rejection of malformed supported responses', () => {
        /** @type {any} */
        const malformed = { result: [{}] };

        assert.throws(() => legacyProtocol.parseMultiMapList(malformed), TypeError);
        assert.throws(() => typedProtocol.parseMultiMapList(malformed), TypeError);
    });
});
