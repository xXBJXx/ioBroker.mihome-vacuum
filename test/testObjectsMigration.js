const assert = require('node:assert/strict');
const legacyObjects = require('../lib/objects');
const typedObjects = require('../build/lib/objects');

describe('ioBroker object catalog TypeScript migration', () => {
    it('preserves the complete recursive catalog without missing or changed definitions', () => {
        assert.deepEqual(typedObjects, legacyObjects);
    });

    it('preserves every top-level catalog consumed by runtime managers', () => {
        assert.deepEqual(Object.keys(typedObjects), [
            'deviceInfo',
            'iotState',
            'customCommands',
            'viomiObjects',
            'stockConsumable',
            'stockControl',
            'enableResumeZone',
            'roomStates',
            'stockInfo',
            'stockHistory',
            'newfan_power',
            'water_box',
            'mop',
            'mop_mode',
            'water_box_mode',
            'water_box_level',
            'dock_status',
            'carpet_mode',
            'dustCollect',
            'washMop',
            'mapObjects',
            'settings',
            'wash_base',
            'wash_base_info',
        ]);
    });

    it('keeps candidate-manager mutations isolated from the productive legacy catalog', () => {
        const originalMax = legacyObjects.newfan_power.common.max;
        typedObjects.newfan_power.common.max = 999;

        assert.equal(legacyObjects.newfan_power.common.max, originalMax);
        typedObjects.newfan_power.common.max = originalMax;
    });
});
