const assert = require('node:assert/strict');
const RoomManager = require('../lib/roomManager');
const TypedRoomManager = require('../build/lib/roomManager');

describe('RoomManager object lookup', () => {
    it('normalizes persisted full room IDs and creates the state object before writing it', async () => {
        const operations = [];
        const adapter = {
            namespace: 'mihome-vacuum.test',
            log: { warn: () => undefined },
            setObject: () => undefined,
            getStates: (_pattern, callback) =>
                callback(null, { 'mihome-vacuum.test.rooms.room17.mapIndex': { val: 17 } }),
            async setObjectNotExistsAsync(id) {
                operations.push(`object:${id}`);
            },
            async setStateAsync(id) {
                operations.push(`state:${id}`);
            },
            async getObjectAsync() {
                return null;
            },
        };

        new RoomManager(adapter, {
            cleanRoom: 'Clean room',
            cleanRooms: 'Clean rooms',
            loadRooms: 'Load rooms',
            cleanMultiRooms: 'Clean multiple rooms',
            addRoom: 'Add room',
        });
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(operations.includes('object:rooms.room17.state'), true);
        assert.equal(operations.includes('state:rooms.room17.state'), true);
        assert.equal(
            operations.indexOf('object:rooms.room17.state') < operations.indexOf('state:rooms.room17.state'),
            true,
        );
        assert.equal(operations.some(operation => operation.includes('mihome-vacuum.test.rooms.room17')), false);
    });

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
        manager.updateRoomStates = async id => {
            updatedRooms.push(id);
        };

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

describe('RoomManager TypeScript migration', () => {
    const translations = {
        cleanRoom: 'Clean room',
        cleanRooms: 'Clean rooms',
        loadRooms: 'Load rooms',
        cleanMultiRooms: 'Clean multiple rooms',
        addRoom: 'Add room',
        notAvailable: 'not available',
    };

    function createAdapter(options = {}) {
        const operations = [];
        const namespace = 'mihome-vacuum.test';
        const stateSets = options.stateSets || {};
        const foreignStates = options.foreignStates || {};
        const foreignObjects = options.foreignObjects || {};
        const roomObjects = options.roomObjects || [];
        const localObjects = options.localObjects || {};
        const optionalObjects = options.optionalObjects || {};
        return {
            operations,
            adapter: {
                namespace,
                log: {
                    info: message => operations.push(['info', message]),
                    warn: message => operations.push(['warn', message]),
                    error: message => operations.push(['error', message]),
                },
                setObject: (id, object, callback) => {
                    operations.push(['setObject', id, structuredClone(object)]);
                    callback?.(null, { id: `${namespace}.${id}` });
                },
                async setObjectNotExistsAsync(id, object) {
                    operations.push(['setObjectNotExistsAsync', id, structuredClone(object)]);
                },
                setState: (id, value, acknowledge) => operations.push(['setState', id, value, acknowledge]),
                async setStateAsync(id, value, acknowledge) {
                    operations.push(['setStateAsync', id, value, acknowledge]);
                },
                setStateChanged: (id, value, acknowledge, callback) => {
                    operations.push(['setStateChanged', id, value, acknowledge]);
                    callback?.(null, id, false);
                },
                setForeignState: (id, value, acknowledge) =>
                    operations.push(['setForeignState', id, value, acknowledge]),
                getStates: (pattern, callback) => {
                    operations.push(['getStates', pattern]);
                    callback(null, stateSets[pattern] || {});
                },
                getForeignStates: (ids, callback) => {
                    operations.push(['getForeignStates', structuredClone(ids)]);
                    callback(
                        null,
                        Object.fromEntries(ids.filter(id => id in foreignStates).map(id => [id, foreignStates[id]])),
                    );
                },
                getChannelsOf: (channel, callback) => {
                    operations.push(['getChannelsOf', channel]);
                    callback(null, structuredClone(roomObjects));
                },
                getObject: (id, callback) => {
                    operations.push(['getObject', id]);
                    callback(null, structuredClone(localObjects[id] || null));
                },
                getObjectAsync: async id => {
                    operations.push(['getObjectAsync', id]);
                    return structuredClone(optionalObjects[id] || null);
                },
                getForeignObjects: (pattern, type, enumName, callback) => {
                    operations.push(['getForeignObjects', pattern, type, enumName]);
                    callback(null, structuredClone(foreignObjects));
                },
                sendTo: (instance, command, message) =>
                    operations.push(['sendTo', instance, command, structuredClone(message)]),
            },
        };
    }

    const settle = () => new Promise(resolve => setImmediate(resolve));

    it('preserves constructor objects and manual room creation', async () => {
        const optionalObjects = {
            'control.fan_power': { common: { name: 'Fan', type: 'number', role: 'level' } },
        };
        const legacy = createAdapter({ optionalObjects });
        const typed = createAdapter({ optionalObjects });
        const legacyManager = new RoomManager(legacy.adapter, translations);
        const typedManager = new TypedRoomManager(typed.adapter, translations);

        await legacyManager.createRoom('manual_zone', '[1,2,3,4]');
        await typedManager.createRoom('manual_zone', '[1,2,3,4]');

        assert.deepEqual(typed.operations, legacy.operations);
        assert.equal(
            typed.operations.some(
                operation =>
                    operation[0] === 'setObjectNotExistsAsync' &&
                    operation[1] === 'rooms.manual_zone.mapIndex' &&
                    operation[2].common.type === 'string',
            ),
            true,
        );
    });

    it('preserves device mappings and generated room states', async () => {
        const roomObjects = [
            {
                _id: 'mihome-vacuum.test.rooms.living-cloud-id',
                common: { name: 'Living' },
                native: {},
                enums: {},
            },
        ];
        const options = { roomObjects };
        const legacy = createAdapter(options);
        const typed = createAdapter(options);
        const legacyManager = new RoomManager(legacy.adapter, translations);
        const typedManager = new TypedRoomManager(typed.adapter, translations);
        const response = {
            result: [
                [16, 'living-cloud-id'],
                [17, 'kitchen-cloud-id'],
                [18, ''],
            ],
        };

        legacyManager.processRoomMaping(structuredClone(response));
        typedManager.processRoomMaping(structuredClone(response));
        await settle();
        await settle();

        legacyManager.processRoomMaping({ result: null });
        typedManager.processRoomMaping({ result: null });

        assert.deepEqual(typed.operations, legacy.operations);
    });

    it('preserves segment, zone, and validation routing', () => {
        const namespace = 'mihome-vacuum.test';
        const ids = [
            `${namespace}.rooms.living.mapIndex`,
            `${namespace}.rooms.kitchen.mapIndex`,
            `${namespace}.rooms.zone.mapIndex`,
            `${namespace}.rooms.invalid.mapIndex`,
            `${namespace}.rooms.wrong.state`,
            '.mapIndex',
        ];
        const foreignStates = {
            [ids[0]]: { val: 16 },
            [ids[1]]: { val: '17' },
            [ids[2]]: { val: '[1,2,3,4]' },
            [ids[3]]: { val: 'invalid' },
            [ids[4]]: { val: true },
            [ids[5]]: { val: 10 },
        };
        const legacy = createAdapter({ foreignStates });
        const typed = createAdapter({ foreignStates });
        const legacyManager = new RoomManager(legacy.adapter, translations);
        const typedManager = new TypedRoomManager(typed.adapter, translations);

        legacyManager.cleanRooms(ids);
        typedManager.cleanRooms(ids);

        assert.deepEqual(typed.operations, legacy.operations);
    });

    it('preserves enum and native-channel room selection', () => {
        const namespace = 'mihome-vacuum.test';
        const timerId = `${namespace}.timer.1_12_00`;
        const livingMap = `${namespace}.rooms.living.mapIndex`;
        const kitchenMap = `${namespace}.rooms.kitchen.mapIndex`;
        const foreignObjects = {
            [timerId]: {
                _id: timerId,
                common: { name: 'Timer' },
                native: { channels: ['kitchen'] },
                enums: { 'enum.rooms.living': 'Living' },
            },
            [livingMap]: {
                _id: livingMap,
                common: { name: 'Living map' },
                native: {},
                enums: { 'enum.rooms.living': 'Living' },
            },
        };
        const foreignStates = {
            [livingMap]: { val: 16 },
            [kitchenMap]: { val: 17 },
        };
        const stateSets = {
            'rooms.*': {
                [livingMap]: { val: 16 },
                [kitchenMap]: { val: 17 },
                [`${namespace}.rooms.living.state`]: { val: 'cleaning' },
            },
        };
        const options = { foreignObjects, foreignStates, stateSets };
        const legacy = createAdapter(options);
        const typed = createAdapter(options);
        const legacyManager = new RoomManager(legacy.adapter, translations);
        const typedManager = new TypedRoomManager(typed.adapter, translations);
        let legacyChannels;
        let typedChannels;

        legacyManager.cleanRoomsFromState(timerId);
        typedManager.cleanRoomsFromState(timerId);
        legacyManager.findChannelsByMapIndex([16], channels => (legacyChannels = channels));
        typedManager.findChannelsByMapIndex([16], channels => (typedChannels = channels));

        assert.deepEqual(typedChannels, legacyChannels);
        assert.deepEqual(typed.operations, legacy.operations);
    });
});
