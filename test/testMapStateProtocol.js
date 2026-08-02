const assert = require('node:assert/strict');
const legacyProtocol = require('../lib/mapStateProtocol');
const typedProtocol = require('../build/lib/mapStateProtocol');

describe('Generic map-state protocol TypeScript migration', () => {
    it('preserves S5/S5e fallback-room construction for numeric and string IDs', () => {
        const roomIds = [16, 21, 'custom'];

        assert.deepEqual(typedProtocol.createFallbackRooms(roomIds), legacyProtocol.createFallbackRooms(roomIds));
        assert.deepEqual(typedProtocol.createFallbackRooms(roomIds), [
            [16, 'room16'],
            [21, 'room21'],
            ['custom', 'roomcustom'],
        ]);
    });

    it('preserves zone-change detection, serialization, and in-place repeat mutation', () => {
        const scenarios = [
            { zones: [[1, 2, 3, 4]], last: [[0, 0, 0, 0]], expected: true },
            { zones: [[1, 9, 8, 7]], last: [[1, 0, 0, 0]], expected: false },
            { zones: [], last: [[0]], expected: false },
            { zones: undefined, last: [[0]], expected: false },
        ];

        for (const scenario of scenarios) {
            assert.equal(
                typedProtocol.shouldUpdateZones(scenario.zones, scenario.last),
                legacyProtocol.shouldUpdateZones(scenario.zones, scenario.last),
            );
            assert.equal(typedProtocol.shouldUpdateZones(scenario.zones, scenario.last), scenario.expected);
        }

        const legacyZones = [[1, 2, 3, 4], [5, 6, 7, 8]];
        const typedZones = [[1, 2, 3, 4], [5, 6, 7, 8]];
        assert.equal(typedProtocol.createZoneStateValue(typedZones), legacyProtocol.createZoneStateValue(legacyZones));
        assert.equal(typedProtocol.createZoneStateValue([[1, 2, 3, 4]]), '[1,2,3,4,1]');
        assert.deepEqual(typedZones, [[1, 2, 3, 4, 1], [5, 6, 7, 8, 1]]);
    });

    it('preserves go-to change detection and comma-separated state values', () => {
        const scenarios = [
            { goTo: [1234, 5678], last: [], expected: true },
            { goTo: [1234, 9999], last: [1234, 5678], expected: false },
            { goTo: [], last: [], expected: false },
            { goTo: undefined, last: [], expected: false },
        ];

        for (const scenario of scenarios) {
            assert.equal(
                typedProtocol.shouldUpdateGoTo(scenario.goTo, scenario.last),
                legacyProtocol.shouldUpdateGoTo(scenario.goTo, scenario.last),
            );
            assert.equal(typedProtocol.shouldUpdateGoTo(scenario.goTo, scenario.last), scenario.expected);
        }
        assert.equal(typedProtocol.createGoToStateValue([1234, 5678]), '1234,5678');
    });
});
