const assert = require('node:assert/strict');
const sinon = require('sinon');
const TimerManager = require('../lib/timerManager');
const TypedTimerManager = require('../build/lib/timerManager');

describe('TimerManager lifecycle', () => {
    it('keeps delayed initialization isolated between instances', async () => {
        const clock = sinon.useFakeTimers();
        const createAdapter = () => {
            const writes = { objects: 0, states: 0 };
            return {
                config: { pingInterval: 20_000 },
                namespace: 'mihome-vacuum.test',
                writes,
                log: {
                    debug: () => undefined,
                    warn: () => undefined,
                },
                formatDate: () => '00:00',
                setObjectNotExists: () => writes.objects++,
                getStatesOf: (_channel, callback) => callback(null, []),
                getStates: (_pattern, callback) => callback(null, {}),
                setObject: () => undefined,
                setState: () => writes.states++,
            };
        };
        const i18n = {
            nextTimer: 'Next timer',
            notAvailable: 'not available',
            weekDaysFull: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        };
        const firstAdapter = createAdapter();
        const secondAdapter = createAdapter();
        const firstManager = new TimerManager(firstAdapter, i18n);
        const secondManager = new TimerManager(secondAdapter, i18n);

        try {
            await clock.tickAsync(500);

            assert.deepEqual(firstAdapter.writes, { objects: 1, states: 1 });
            assert.deepEqual(secondAdapter.writes, { objects: 1, states: 1 });
        } finally {
            firstManager.close();
            secondManager.close();
            clock.restore();
        }
    });

    it('cancels its initialization timer once and performs no write after close', async () => {
        const clock = sinon.useFakeTimers();
        let objectWrites = 0;
        let stateWrites = 0;
        const adapter = {
            config: { pingInterval: 20000 },
            setObjectNotExists: () => objectWrites++,
            setState: () => stateWrites++,
        };
        try {
            const manager = new TimerManager(adapter, { nextTimer: 'Next timer' });

            manager.close();
            manager.close();
            await clock.tickAsync(1000);

            assert.equal(objectWrites, 0);
            assert.equal(stateWrites, 0);
            assert.equal(manager.timeouts.size, 0);
        } finally {
            clock.restore();
        }
    });
});

describe('TimerManager TypeScript migration', () => {
    const translations = {
        nextTimer: 'Next timer',
        notAvailable: 'not available',
        weekDaysFull: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    };

    function createAdapter() {
        const writes = [];
        return {
            adapter: {
                config: { pingInterval: 20_000 },
                namespace: 'mihome-vacuum.test',
                log: {
                    debug: () => undefined,
                    info: () => undefined,
                    warn: () => undefined,
                },
                formatDate: date => `${date.getHours()}:${date.getMinutes()}`,
                setObjectNotExists: (id, object) => writes.push(['setObjectNotExists', id, object]),
                setObject: (id, object) => writes.push(['setObject', id, object]),
                setState: (id, value, acknowledge) => writes.push(['setState', id, value, acknowledge]),
                setForeignState: (_id, _value, _acknowledge, callback) => callback(null, {}),
                getChannelsOf: (_channel, callback) =>
                    callback(null, [{ _id: 'mihome-vacuum.test.rooms.kitchen', common: { name: 'Kitchen' } }]),
                getStatesOf: (_channel, callback) => callback(null, []),
                getStates: (_pattern, callback) => callback(null, {}),
                supportsFeature: () => false,
                getPluginInstance: () => undefined,
            },
            writes,
        };
    }

    it('preserves constants and delayed initialization writes', async () => {
        const clock = sinon.useFakeTimers();
        const legacy = createAdapter();
        const typed = createAdapter();
        const legacyManager = new TimerManager(legacy.adapter, translations);
        const typedManager = new TypedTimerManager(typed.adapter, translations);

        try {
            await clock.tickAsync(500);
            assert.deepEqual(
                [TypedTimerManager.DISABLED, TypedTimerManager.SKIP, TypedTimerManager.ENABLED, TypedTimerManager.START],
                [TimerManager.DISABLED, TimerManager.SKIP, TimerManager.ENABLED, TimerManager.START],
            );
            assert.deepEqual(typed.writes, legacy.writes);
        } finally {
            legacyManager.close();
            typedManager.close();
            clock.restore();
        }
    });

    it('preserves next-run calculation and room-name updates', () => {
        const legacy = createAdapter();
        const typed = createAdapter();
        const legacyManager = new TimerManager(legacy.adapter, translations);
        const typedManager = new TypedTimerManager(typed.adapter, translations);
        const legacyObject = {
            _id: 'mihome-vacuum.test.timer.135_14_30',
            native: { channels: ['kitchen'] },
            common: { name: '', states: {} },
        };
        const typedObject = structuredClone(legacyObject);
        const now = new Date(2026, 7, 3, 10, 0, 0, 0);

        try {
            assert.deepEqual(
                typedManager._calcNextProcessTime(typedObject, now),
                legacyManager._calcNextProcessTime(legacyObject, now),
            );
            assert.deepEqual(typedObject, legacyObject);
            assert.deepEqual(typed.writes, legacy.writes);
        } finally {
            legacyManager.close();
            typedManager.close();
        }
    });

    it('preserves the legacy invalid persisted-date contract', () => {
        const legacy = createAdapter();
        const typed = createAdapter();
        const legacyManager = new TimerManager(legacy.adapter, translations);
        const typedManager = new TypedTimerManager(typed.adapter, translations);
        const legacyObject = {
            _id: 'mihome-vacuum.test.timer.1_12_00',
            native: { nextProcessTime: 'invalid' },
            common: { name: '', states: {} },
        };
        const typedObject = structuredClone(legacyObject);

        try {
            const legacyResult = legacyManager._calcNextProcessTime(legacyObject, new Date(2026, 7, 3));
            const typedResult = typedManager._calcNextProcessTime(typedObject, new Date(2026, 7, 3));

            assert.equal(Number.isNaN(Number(legacyResult)), true);
            assert.equal(Number.isNaN(Number(typedResult)), true);
            assert.deepEqual(typedObject, legacyObject);
            assert.deepEqual(typed.writes, legacy.writes);
        } finally {
            legacyManager.close();
            typedManager.close();
        }
    });
});
