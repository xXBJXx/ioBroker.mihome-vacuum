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

describe('Adapter TypeScript runtime entry point', () => {
    it('provides the compact-mode factory, adapter name, events, and initial state', () => {
        const factory = loadFactory('../build/main');
        const adapter = factory({ synthetic: true });

        assert.deepEqual(adapter.options, { synthetic: true, name: 'mihome-vacuum' });
        assert.deepEqual(adapter.eventNames().sort(), ['message', 'ready', 'stateChange', 'unload']);
        assert.equal(adapter.unsupportedFeatures, '|');
        assert.equal(adapter.miio, null);
        assert.equal(adapter.vacuum, null);
        assert.equal(adapter.xiaomiApi, null);
    });
});
