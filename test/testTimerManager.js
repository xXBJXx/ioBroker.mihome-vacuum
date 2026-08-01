const assert = require('node:assert/strict');
const sinon = require('sinon');
const TimerManager = require('../lib/timerManager');

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
