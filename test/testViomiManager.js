const assert = require('node:assert/strict');
const ViomiManager = require('../lib/viomi');

function createAdapter() {
    const states = new Map();
    const debugMessages = [];
    return {
        config: { pingInterval: 60_000 },
        states,
        debugMessages,
        log: {
            debug: message => debugMessages.push(String(message)),
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        },
        async setObjectNotExistsAsync() {},
        async setStateAsync(id, state) {
            states.set(id, state);
        },
    };
}

async function waitForPolling() {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
}

describe('ViomiManager status polling', () => {
    it('waits for all state definitions during initialization', async () => {
        const adapter = createAdapter();
        /** @type {() => void} */
        let releaseWrites = () => undefined;
        const writeGate = new Promise(resolve => {
            releaseWrites = () => resolve(undefined);
        });
        const writtenIds = [];
        adapter.setObjectNotExistsAsync = async id => {
            writtenIds.push(id);
            await writeGate;
        };
        const originalMain = ViomiManager.prototype.main;
        ViomiManager.prototype.main = async () => undefined;
        let manager;
        try {
            manager = new ViomiManager(adapter, { sendMessage: async () => ({}) });
        } finally {
            ViomiManager.prototype.main = originalMain;
        }

        let initializationCompleted = false;
        const initialization = manager.initStates().then(() => {
            initializationCompleted = true;
        });
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(writtenIds.includes('control.run_state'), true);
        assert.equal(initializationCompleted, false);

        releaseWrites();
        await initialization;
        assert.equal(initializationCompleted, true);
        await manager.close();
    });

    it('does not log complete Viomi responses', async () => {
        const adapter = createAdapter();
        const manager = new ViomiManager(adapter, {
            sendMessage: async () => ({ result: ['SENSITIVE_VIOMI_MARKER'] }),
        });

        await waitForPolling();
        await manager.close();

        assert.equal(adapter.debugMessages.join('\n').includes('SENSITIVE_VIOMI_MARKER'), false);
    });

    it('keeps adapter state and latest properties isolated between instances', async () => {
        const firstAdapter = createAdapter();
        const secondAdapter = createAdapter();
        const firstCalls = [];
        const secondCalls = [];
        const createMiio = (calls, mode) => ({
            sendMessage: async (method, params) => {
                calls.push({ method, params });
                if (method !== 'get_prop') {
                    return { result: ['ok'] };
                }
                const result = new Array(22).fill(0);
                result[2] = mode;
                result[17] = 0;
                return { result };
            },
        });
        const firstManager = new ViomiManager(firstAdapter, createMiio(firstCalls, 2));
        await waitForPolling();
        const secondManager = new ViomiManager(secondAdapter, createMiio(secondCalls, 3));
        await waitForPolling();

        await firstManager.stateChange('mihome-vacuum.0.control.start', { val: true, ack: false });
        await firstManager.close();
        await secondManager.close();

        assert.deepEqual(firstCalls[firstCalls.length - 1], {
            method: 'set_mode_withroom',
            params: [2, 1, 0],
        });
        assert.deepEqual(firstAdapter.states.get('mihome-vacuum.0.control.start'), { val: true, ack: true });
        assert.equal(secondAdapter.states.has('mihome-vacuum.0.control.start'), false);
    });

    it('does not process or reschedule an in-flight poll after close', async () => {
        const adapter = createAdapter();
        /** @type {(value: any) => void} */
        let resolvePoll = _value => undefined;
        const pollStarted = new Promise(resolve => {
            resolvePoll = resolve;
        });
        /** @type {(value: any) => void} */
        let releasePoll = _value => undefined;
        const pollResult = new Promise(resolve => {
            releasePoll = resolve;
        });
        const manager = new ViomiManager(adapter, {
            sendMessage: async () => {
                resolvePoll(undefined);
                return pollResult;
            },
        });

        await pollStarted;
        await manager.close();
        releasePoll({ result: [5, 3] });
        await waitForPolling();

        assert.equal(adapter.states.size, 0);
        assert.deepEqual(manager.globalTimeouts, {});
    });

    it('maps a get_prop response to matching Viomi states', async () => {
        const adapter = createAdapter();
        const miio = {
            sendMessage: async () => ({
                result: [5, 3, 1, 2105, 80, 0, '0', 30, 42, 10, '0', 0, 1, 1, 2, 1, 1, 0, 1, 1, 0, 1],
            }),
        };
        const manager = new ViomiManager(adapter, miio);

        await waitForPolling();
        await manager.close();

        assert.deepEqual(adapter.states.get('control.run_state'), { val: 5, ack: true });
        assert.deepEqual(adapter.states.get('control.suction_grade'), { val: 3, ack: true });
        assert.deepEqual(adapter.states.get('control.battary_life'), { val: 80, ack: true });
        assert.deepEqual(adapter.states.get('control.light_state'), { val: true, ack: true });
    });

    it('updates available values from a shorter response without reading beyond it', async () => {
        const adapter = createAdapter();
        const manager = new ViomiManager(adapter, {
            sendMessage: async () => ({ result: [5, 2] }),
        });

        await waitForPolling();
        await manager.close();

        assert.deepEqual([...adapter.states.keys()].sort(), ['control.run_state', 'control.suction_grade']);
    });

    it('ignores a malformed non-array result', async () => {
        const adapter = createAdapter();
        const manager = new ViomiManager(adapter, {
            sendMessage: async () => ({ result: { unexpected: true } }),
        });

        await waitForPolling();
        await manager.close();

        assert.equal(adapter.states.size, 0);
    });
});
