const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();

class FakeAdapter extends EventEmitter {
    constructor(options) {
        super();
        this.options = options;
        this.config = {};
        this.log = { debug() {}, info() {}, warn() {}, error() {} };
        this.namespace = 'mihome-vacuum.0';
    }
}

class FakeDependency {}

function loadFactory(modulePath) {
    return proxyquire(modulePath, {
        '@iobroker/adapter-core': { Adapter: FakeAdapter },
        './lib/XiaomiCloudConnector': FakeDependency,
        './lib/miio': FakeDependency,
        './lib/viomi': FakeDependency,
        './lib/vacuum': FakeDependency,
        './lib/dreame': FakeDependency,
    });
}

describe('Adapter entry-point TypeScript migration', () => {
    it('preserves compact-mode factory, adapter name, events, and initial state', () => {
        const legacyFactory = loadFactory('../main');
        const typedFactory = loadFactory('../build/main');
        const legacy = legacyFactory({ synthetic: true });
        const typed = typedFactory({ synthetic: true });
        const selectState = adapter => ({
            options: adapter.options,
            events: adapter.eventNames().sort(),
            unsupportedFeatures: adapter.unsupportedFeatures,
            miio: adapter.miio,
            vacuum: adapter.vacuum,
            xiaomiApi: adapter.xiaomiApi,
        });

        assert.deepEqual(selectState(typed), selectState(legacy));
        assert.deepEqual(typed.options, { synthetic: true, name: 'mihome-vacuum' });
        assert.deepEqual(typed.eventNames().sort(), ['message', 'ready', 'stateChange', 'unload']);
    });
});
