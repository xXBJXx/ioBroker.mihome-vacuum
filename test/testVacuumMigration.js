const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();

class FakeMapHelper {
    async shutdown() {}
}

class FakeManager {
    close() {}
}

class FakeFeatureManager {
    constructor() {
        this.roomMapping = null;
    }
}

function loadManager(modulePath) {
    return proxyquire(modulePath, {
        './maphelper': FakeMapHelper,
        './timerManager.js': FakeManager,
        './roomManager': FakeManager,
        './featureManager': FakeFeatureManager,
    });
}

function createManager(Manager) {
    const adapter = {
        config: {},
        device: 'roborock.vacuum.synthetic',
        log: { debug() {}, info() {}, warn() {}, error() {} },
        getState: (_id, callback) => callback(null, null),
    };
    const originalMain = Manager.prototype.main;
    Manager.prototype.main = () => undefined;
    try {
        return new Manager(adapter, { sendMessage: async () => ({}) });
    } finally {
        Manager.prototype.main = originalMain;
    }
}

describe('VacuumManager complete TypeScript migration', () => {
    it('preserves the complete public and internal prototype surface', () => {
        const LegacyManager = loadManager('../lib/vacuum');
        const TypedManager = loadManager('../build/lib/vacuum');

        assert.deepEqual(
            Object.getOwnPropertyNames(TypedManager.prototype).sort(),
            Object.getOwnPropertyNames(LegacyManager.prototype).sort(),
        );
    });

    it('preserves initial generic-manager state without narrowing to one model', async () => {
        const LegacyManager = loadManager('../lib/vacuum');
        const TypedManager = loadManager('../build/lib/vacuum');
        const legacy = createManager(LegacyManager);
        const typed = createManager(TypedManager);
        const selectState = manager => ({
            device: manager.device,
            vacuum: manager.vacuum,
            carpetModeSettings: manager.carpetModeSettings,
            closed: manager.closed,
            Error: manager.Error,
            cleanActiveState: manager.cleanActiveState,
            queue: manager.queue,
            mapEnable: manager.mapEnable,
            mapReady: manager.mapReady,
        });

        assert.deepEqual(selectState(typed), selectState(legacy));
        await legacy.close();
        await typed.close();
    });
});
