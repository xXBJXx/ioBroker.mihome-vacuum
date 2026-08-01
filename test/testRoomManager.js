const assert = require('node:assert/strict');
const RoomManager = require('../lib/roomManager');

describe('RoomManager object lookup', () => {
    it('creates room channels through the supported object API', async () => {
        const objects = new Map();
        const states = new Map();
        const adapter = {
            namespace: 'mihome-vacuum.test',
            log: { info: () => undefined, warn: () => undefined },
            setObject: () => undefined,
            getStates: (_pattern, callback) => callback(null, {}),
            async setObjectNotExistsAsync(id, object) {
                objects.set(id, object);
            },
            async setStateAsync(id, value, ack) {
                states.set(id, { value, ack });
            },
        };
        const manager = new RoomManager(adapter, {
            cleanRoom: 'Clean room',
            cleanRooms: 'Clean rooms',
            loadRooms: 'Load rooms',
            cleanMultiRooms: 'Clean multiple rooms',
            addRoom: 'Add room',
        });
        const updatedRooms = [];
        manager.updateRoomStates = id => updatedRooms.push(id);

        await manager.createRoom('living', 16);

        assert.deepEqual(objects.get('rooms.living'), {
            type: 'channel',
            common: { name: 'living' },
            native: {},
        });
        assert.equal(objects.get('rooms.living.mapIndex').common.type, 'number');
        assert.deepEqual(states.get('rooms.living.mapIndex'), { value: 16, ack: true });
        assert.deepEqual(updatedRooms, ['rooms.living']);
        assert.equal('createChannel' in adapter, false);
    });

    it('keeps object lookups isolated between adapter instances', async () => {
        const createAdapter = namespace => {
            const foreignPatterns = [];
            return {
                namespace,
                foreignPatterns,
                setObject: () => undefined,
                getStates: (_pattern, callback) => callback(null, {}),
                getForeignObjects: (pattern, _type, _enumName, callback) => {
                    foreignPatterns.push(pattern);
                    callback(null, {});
                },
            };
        };
        const i18n = {
            cleanRoom: 'Clean room',
            cleanRooms: 'Clean rooms',
            loadRooms: 'Load rooms',
            cleanMultiRooms: 'Clean multiple rooms',
            addRoom: 'Add room',
        };
        const firstAdapter = createAdapter('mihome-vacuum.first');
        const secondAdapter = createAdapter('mihome-vacuum.second');
        const firstManager = new RoomManager(firstAdapter, i18n);
        new RoomManager(secondAdapter, i18n);

        await new Promise(resolve => firstManager.findMapIndexByRoom('enum.rooms.test', resolve));

        assert.deepEqual(firstAdapter.foreignPatterns, ['mihome-vacuum.first.rooms.*']);
        assert.deepEqual(secondAdapter.foreignPatterns, []);
    });

    it('uses an optimizable own-namespace prefix and preserves mapIndex matches', async () => {
        const ownPrefix = 'mihome-vacuum.test.rooms.';
        const objects = {
            [`${ownPrefix}living.mapIndex`]: { enums: { 'enum.rooms.living': 'Living' }, native: {} },
            [`${ownPrefix}kitchen.mapIndex`]: { enums: { 'enum.rooms.kitchen': 'Kitchen' }, native: {} },
            [`${ownPrefix}living.roomFanPower`]: { enums: { 'enum.rooms.living': 'Living' }, native: {} },
            'other-adapter.0.rooms.living.mapIndex': { enums: { 'enum.rooms.living': 'Living' }, native: {} },
        };
        const requestedPatterns = [];
        const adapter = {
            namespace: 'mihome-vacuum.test',
            setObject: () => undefined,
            getStates: (pattern, callback) => {
                requestedPatterns.push(pattern);
                callback(null, {});
            },
            getForeignObjects: (pattern, type, enumName, callback) => {
                requestedPatterns.push(pattern);
                const prefix = pattern.slice(0, -1);
                callback(
                    null,
                    Object.fromEntries(Object.entries(objects).filter(([id]) => id.startsWith(prefix))),
                );
            },
        };
        const manager = new RoomManager(adapter, {
            cleanRoom: 'Clean room',
            cleanRooms: 'Clean rooms',
            loadRooms: 'Load rooms',
            cleanMultiRooms: 'Clean multiple rooms',
            addRoom: 'Add room',
        });
        const legacyExpected = Object.keys(objects).filter(
            id =>
                id.startsWith(ownPrefix) &&
                id.endsWith('.mapIndex') &&
                Object.keys(objects[id].enums).includes('enum.rooms.living'),
        );

        const actual = await new Promise(resolve => manager.findMapIndexByRoom('enum.rooms.living', resolve));

        assert.deepEqual(requestedPatterns, ['mihome-vacuum.test.rooms.*', 'mihome-vacuum.test.rooms.*']);
        assert.deepEqual(actual, legacyExpected);
        assert.deepEqual(actual, ['mihome-vacuum.test.rooms.living.mapIndex']);

        let statePattern;
        adapter.getStates = (pattern, callback) => {
            statePattern = pattern;
            callback(null, {
                'mihome-vacuum.test.rooms.living.mapIndex': { val: 16 },
                'mihome-vacuum.test.rooms.kitchen.mapIndex': { val: 17 },
                'mihome-vacuum.test.rooms.living.roomFanPower': { val: 16 },
            });
        };
        const channels = await new Promise(resolve => manager.findChannelsByMapIndex([16], resolve));

        assert.equal(statePattern, 'rooms.*');
        assert.deepEqual(channels, ['mihome-vacuum.test.rooms.living']);
    });
});
