const assert = require('node:assert/strict');
const DreameManager = require('../lib/dreame');

function createAdapter() {
    const states = new Map();
    const debugMessages = [];
    return {
        config: { pingInterval: 60_000 },
        namespace: 'mihome-vacuum.test',
        states,
        debugMessages,
        log: {
            debug: message => debugMessages.push(String(message)),
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        },
        async setObjectAsync() {},
        async setObjectNotExistsAsync() {},
        async setStateAsync(id, state) {
            states.set(id, state);
        },
    };
}

async function waitForManager() {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
}

describe('DreameManager status polling', () => {
    it('handles a failed optional wash-base probe without exposing the failure', async () => {
        const adapter = createAdapter();
        let callCount = 0;
        const manager = new DreameManager(adapter, {
            sendMessage: async () => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('SENSITIVE_WASH_BASE_PROBE_MARKER');
                }
                return { result: [] };
            },
        });

        await manager.ready;
        await waitForManager();
        await manager.close();

        assert.equal(adapter.debugMessages.includes('Could not determine wash base availability'), true);
        assert.equal(adapter.debugMessages.join('\n').includes('SENSITIVE_WASH_BASE_PROBE_MARKER'), false);
    });

    it('does not log complete Dreame property responses', async () => {
        const adapter = createAdapter();
        let callCount = 0;
        const manager = new DreameManager(adapter, {
            sendMessage: async (_method, params) => {
                callCount++;
                if (callCount === 1) {
                    return { result: [{ code: -1 }] };
                }
                if (callCount === 2) {
                    return {
                        result: [{ ...params[0], value: 'SENSITIVE_DREAME_MARKER', code: 0 }],
                    };
                }
                return { result: [] };
            },
        });

        await waitForManager();
        await manager.close();

        assert.equal(adapter.debugMessages.join('\n').includes('SENSITIVE_DREAME_MARKER'), false);
    });

    it('keeps state writes isolated between adapter instances', async () => {
        const firstAdapter = createAdapter();
        const secondAdapter = createAdapter();
        let firstCallCount = 0;
        let firstPropertyRequest = [];
        /** @type {(value: any) => void} */
        let resolvePollStarted = _value => undefined;
        const pollStarted = new Promise(resolve => {
            resolvePollStarted = resolve;
        });
        /** @type {(value: any) => void} */
        let releasePoll = _value => undefined;
        const pollResult = new Promise(resolve => {
            releasePoll = resolve;
        });
        const firstManager = new DreameManager(firstAdapter, {
            sendMessage: async (_method, params) => {
                firstCallCount++;
                if (firstCallCount === 1) {
                    return { result: [{ code: -1 }] };
                }
                if (firstCallCount === 2) {
                    firstPropertyRequest = params;
                    resolvePollStarted(undefined);
                    return pollResult;
                }
                return { result: [] };
            },
        });

        await pollStarted;
        let secondCallCount = 0;
        const secondManager = new DreameManager(secondAdapter, {
            sendMessage: async () => {
                secondCallCount++;
                return secondCallCount === 1 ? { result: [{ code: -1 }] } : { result: [] };
            },
        });
        await waitForManager();
        releasePoll({
            result: [{ ...firstPropertyRequest[0], value: 1, code: 0 }],
        });
        await waitForManager();
        await firstManager.close();
        await secondManager.close();

        assert.equal(firstAdapter.states.size, 1);
        assert.equal(secondAdapter.states.size, 0);
    });

    it('does not continue or reschedule an in-flight chunk after close', async () => {
        const adapter = createAdapter();
        let callCount = 0;
        /** @type {(value: any) => void} */
        let resolvePollStarted = _value => undefined;
        const pollStarted = new Promise(resolve => {
            resolvePollStarted = resolve;
        });
        /** @type {(value: any) => void} */
        let releasePoll = _value => undefined;
        const pollResult = new Promise(resolve => {
            releasePoll = resolve;
        });
        const manager = new DreameManager(adapter, {
            sendMessage: async () => {
                callCount++;
                if (callCount === 1) {
                    return { result: [{ code: -1 }] };
                }
                resolvePollStarted(undefined);
                return pollResult;
            },
        });

        await pollStarted;
        await manager.close();
        releasePoll({ result: [] });
        await waitForManager();

        assert.equal(callCount, 2);
        assert.equal(adapter.states.size, 0);
        assert.deepEqual(manager.globalTimeouts, {});
    });
});
