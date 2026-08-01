const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();

class FakeAdapter extends EventEmitter {
    constructor(options = {}) {
        super();
        this.config = options.config || {};
        this.namespace = 'mihome-vacuum.test';
        this.debugMessages = [];
        this.warnMessages = [];
        this.errorMessages = [];
        this.sentMessages = [];
        this.log = {
            debug: message => this.debugMessages.push(String(message)),
            info: () => undefined,
            warn: message => this.warnMessages.push(String(message)),
            error: message => this.errorMessages.push(String(message)),
        };
    }

    async setObjectNotExistsAsync() {}
    async delObjectAsync() {}
    async getStateAsync() {
        return null;
    }
    async setStateAsync() {}
    subscribeStates() {}
    sendTo(from, command, response, callback) {
        this.sentMessages.push({ from, command, response, callback });
    }
}

/**
 * @param {{ closeThrows?: boolean, managerCloseThrows?: boolean, managerReadyRejects?: boolean, modelResponses?: object[] }} [options]
 */
function createAdapter({ closeThrows = false, managerCloseThrows = false, managerReadyRejects = false, modelResponses } = {}) {
    const counters = {
        udpClose: 0,
        managerClose: 0,
        mainCloudClose: 0,
        modelRequests: 0,
    };
    const successfulModelResponse = {
        result: { model: 'roborock.vacuum.test', fw_ver: 'test', mac: 'test' },
    };
    const responses = modelResponses ? [...modelResponses] : [successfulModelResponse];

    class FakeMiio extends EventEmitter {
        async sendMessage() {
            counters.modelRequests++;
            return responses.length ? responses.shift() : successfulModelResponse;
        }

        close(callback) {
            counters.udpClose++;
            callback();
            if (closeThrows) throw new Error('synthetic close failure after callback');
        }
    }

    class FakeVacuumManager {
        constructor() {
            this.ready = managerReadyRejects
                ? Promise.reject(new Error('SENSITIVE_MANAGER_INITIALIZATION_MARKER'))
                : Promise.resolve();
        }

        async close() {
            counters.managerClose++;
            if (managerCloseThrows) throw new Error('synthetic manager close failure');
        }
    }

    class FakeCloudConnector {
        shutdown() {
            counters.mainCloudClose++;
        }
    }

    const startAdapter = proxyquire('./main', {
        '@iobroker/adapter-core': { Adapter: FakeAdapter },
        './lib/miio': FakeMiio,
        './lib/viomi': class {},
        './lib/vacuum': FakeVacuumManager,
        './lib/dreame': class {},
        './lib/XiaomiCloudConnector': FakeCloudConnector,
    });
    return {
        adapter: startAdapter({
            config: {
                token: '00000000000000000000000000000000',
                pingInterval: 20000,
            },
        }),
        counters,
    };
}

describe('Adapter unload lifecycle', () => {
    it('keeps manager, UDP client, cloud login, and state routing isolated between compact-mode instances', async () => {
        const managers = [];
        const clients = [];
        const cloudConnectors = [];

        class SharedFakeMiio extends EventEmitter {
            constructor(adapter) {
                super();
                this.adapter = adapter;
                this.closeCalls = 0;
                clients.push(this);
            }

            async sendMessage() {
                return {
                    result: { model: 'roborock.vacuum.test', fw_ver: 'test', mac: 'test' },
                };
            }

            close(callback) {
                this.closeCalls++;
                callback();
            }
        }

        class SharedFakeVacuumManager {
            constructor(adapter, client) {
                this.adapter = adapter;
                this.client = client;
                this.stateChanges = [];
                this.closeCalls = 0;
                managers.push(this);
            }

            stateChange(id) {
                this.stateChanges.push(id);
            }

            async close() {
                this.closeCalls++;
            }
        }

        class SharedFakeCloudConnector {
            constructor(log, auth, adapter) {
                this.adapter = adapter;
                this.startCalls = 0;
                this.shutdownCalls = 0;
                cloudConnectors.push(this);
            }

            async startQrLogin() {
                this.startCalls++;
                return { owner: this.adapter.namespace };
            }

            shutdown() {
                this.shutdownCalls++;
            }
        }

        const startAdapter = proxyquire('./main', {
            '@iobroker/adapter-core': { Adapter: FakeAdapter },
            './lib/miio': SharedFakeMiio,
            './lib/viomi': class {},
            './lib/vacuum': SharedFakeVacuumManager,
            './lib/dreame': class {},
            './lib/XiaomiCloudConnector': SharedFakeCloudConnector,
        });
        const firstAdapter = startAdapter({ config: { token: true }, namespace: 'mihome-vacuum.first' });
        const secondAdapter = startAdapter({ config: { token: true }, namespace: 'mihome-vacuum.second' });
        firstAdapter.namespace = 'mihome-vacuum.first';
        secondAdapter.namespace = 'mihome-vacuum.second';

        await firstAdapter.main();
        await firstAdapter.getModel();
        await secondAdapter.main();
        await secondAdapter.getModel();
        await firstAdapter.onStateChange('mihome-vacuum.first.control.start', { val: true, ack: false });
        await secondAdapter.onStateChange('mihome-vacuum.second.control.start', { val: true, ack: false });
        await firstAdapter.onMessage({ command: 'startCloudLogin', message: {}, from: 'admin', callback: 'first' });
        await secondAdapter.onMessage({ command: 'startCloudLogin', message: {}, from: 'admin', callback: 'second' });
        await firstAdapter.onUnload(() => undefined);
        await secondAdapter.onUnload(() => undefined);

        assert.equal(managers.length, 2);
        assert.deepEqual(managers[0].stateChanges, ['mihome-vacuum.first.control.start']);
        assert.deepEqual(managers[1].stateChanges, ['mihome-vacuum.second.control.start']);
        assert.deepEqual(managers.map(manager => manager.closeCalls), [1, 1]);
        assert.deepEqual(clients.map(client => client.closeCalls), [1, 1]);
        assert.equal(managers[0].client, clients[0]);
        assert.equal(managers[1].client, clients[1]);
        assert.equal(cloudConnectors.length, 2);
        assert.deepEqual(cloudConnectors.map(connector => connector.startCalls), [1, 1]);
        assert.deepEqual(cloudConnectors.map(connector => connector.shutdownCalls), [1, 1]);
        assert.deepEqual(firstAdapter.sentMessages[0].response, { owner: 'mihome-vacuum.first' });
        assert.deepEqual(secondAdapter.sentMessages[0].response, { owner: 'mihome-vacuum.second' });
    });

    it('invokes the unload callback once even if closing throws after callback', async () => {
        const { adapter } = createAdapter({ closeThrows: true });
        let callbackCalls = 0;

        await adapter.main();
        await adapter.onUnload(() => callbackCalls++);

        assert.equal(callbackCalls, 1);
    });

    it('runs its resource shutdown path once across repeated unload calls', async () => {
        const { adapter, counters } = createAdapter();
        let firstCallbackCalls = 0;
        let secondCallbackCalls = 0;

        await adapter.onReady();
        await new Promise(resolve => setImmediate(resolve));
        await adapter.getModel();
        await Promise.all([
            adapter.onUnload(() => firstCallbackCalls++),
            adapter.onUnload(() => secondCallbackCalls++),
        ]);

        assert.deepEqual(counters, {
            udpClose: 1,
            managerClose: 1,
            mainCloudClose: 1,
            modelRequests: 1,
        });
        assert.equal(firstCallbackCalls, 1);
        assert.equal(secondCallbackCalls, 1);
    });

    it('closes UDP even if manager shutdown fails', async () => {
        const { adapter, counters } = createAdapter({ managerCloseThrows: true });
        let callbackCalls = 0;

        await adapter.onReady();
        await new Promise(resolve => setImmediate(resolve));
        await adapter.getModel();
        await adapter.onUnload(() => callbackCalls++);

        assert.equal(counters.managerClose, 1);
        assert.equal(counters.udpClose, 1);
        assert.equal(callbackCalls, 1);
    });

    it('retries miIO.info sequentially and logs only a real result as success', async () => {
        const success = { result: { model: 'roborock.vacuum.test', fw_ver: 'test', mac: 'test' } };
        const { adapter, counters } = createAdapter({ modelResponses: [{}, success] });

        await adapter.main();
        await adapter.getModel();

        assert.equal(counters.modelRequests, 2);
        assert.equal(adapter.debugMessages.includes('miIO.info attempt 1/5 completed without device information'), true);
        assert.equal(adapter.debugMessages.includes('miIO.info attempt 2/5 succeeded'), true);
        assert.equal(adapter.debugMessages.includes('miIO.info response received'), false);
        await adapter.onUnload(() => undefined);
    });

    it('waits for manager initialization and cleans up a failed manager safely', async () => {
        const { adapter, counters } = createAdapter({ managerReadyRejects: true });
        const connectionValues = [];
        adapter.setStateAsync = async (id, state) => {
            if (id === 'info.connection') {
                connectionValues.push(state.val);
            }
        };

        await adapter.main();
        await adapter.getModel();

        assert.equal(adapter.vacuum, null);
        assert.equal(counters.managerClose, 1);
        assert.deepEqual(connectionValues, [true, false]);
        assert.equal(adapter.errorMessages.includes('Could not initialize the selected vacuum manager'), true);
        assert.equal(adapter.errorMessages.join('\n').includes('SENSITIVE_MANAGER_INITIALIZATION_MARKER'), false);
        await adapter.onUnload(() => undefined);
    });

    it('waits for custom command and IoT state creation before startup completes', async () => {
        const { adapter } = createAdapter();
        adapter.config.enableSelfCommands = true;
        adapter.config.enableAlexa = true;
        const delayedIds = [];
        /** @type {() => void} */
        let releaseWrites = () => undefined;
        const writeGate = new Promise(resolve => {
            releaseWrites = () => resolve(undefined);
        });
        adapter.setObjectNotExistsAsync = async id => {
            if (id === 'control.X_send_command' || id === 'control.pauseResume') {
                delayedIds.push(id);
                await writeGate;
            }
        };

        let startupCompleted = false;
        const startup = adapter.main().then(() => {
            startupCompleted = true;
        });
        await new Promise(resolve => setImmediate(resolve));

        assert.deepEqual(delayedIds, ['control.X_send_command']);
        assert.equal(startupCompleted, false);

        releaseWrites();
        await startup;
        assert.deepEqual(delayedIds.sort(), ['control.X_send_command', 'control.pauseResume']);
        assert.equal(startupCompleted, true);
        await adapter.onUnload(() => undefined);
    });

    it('waits for optional state cleanup without deleting the shared control channel', async () => {
        const { adapter } = createAdapter();
        const deletedIds = [];
        /** @type {() => void} */
        let releaseDeletes = () => undefined;
        const deleteGate = new Promise(resolve => {
            releaseDeletes = () => resolve(undefined);
        });
        adapter.delObjectAsync = async id => {
            deletedIds.push(id);
            await deleteGate;
        };

        let startupCompleted = false;
        const startup = adapter.main().then(() => {
            startupCompleted = true;
        });
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(deletedIds.includes('control'), false);
        assert.equal(deletedIds.includes('control.X_send_command'), true);
        assert.equal(startupCompleted, false);

        releaseDeletes();
        await startup;
        assert.equal(deletedIds.includes('control.pauseResume'), true);
        assert.equal(startupCompleted, true);
        await adapter.onUnload(() => undefined);
    });

    it('restores and normalizes unsupported features before startup completes', async () => {
        const { adapter } = createAdapter();
        /** @type {(state: {val: string}) => void} */
        let releaseState = () => undefined;
        const stateGate = new Promise(resolve => {
            releaseState = resolve;
        });
        adapter.getStateAsync = async id => {
            if (id === 'deviceInfo.unsupported') {
                return stateGate;
            }
            return null;
        };

        let startupCompleted = false;
        const startup = adapter.main().then(() => {
            startupCompleted = true;
        });
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(startupCompleted, false);
        assert.equal(adapter.isUnsupportedFeature('segemntCleanRepeat'), false);

        releaseState({ val: 'segemntCleanRepeat' });
        await startup;

        assert.equal(adapter.unsupportedFeatures, '|segemntCleanRepeat|');
        assert.equal(adapter.isUnsupportedFeature('segemntCleanRepeat'), true);
        await adapter.onUnload(() => undefined);
    });
});
