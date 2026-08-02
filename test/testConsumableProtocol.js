const assert = require('node:assert/strict');
const objects = require('../lib/objects');
const commands = require('../lib/stockCommands');
const legacyProtocol = require('../lib/consumableProtocol');
const typedProtocol = require('../build/lib/consumableProtocol');

function createConsumableValues() {
    return {
        filter_work_time: 2700,
        sensor_dirty_time: 1080,
        main_brush_work_time: 5400,
        mop_pad_work_time: 1440,
        side_brush_work_time: 3600,
        filter_element_work_time: 1800,
        strainer_work_times: 12,
        cleaning_brush_work_times: 5,
        dust_collection_work_times: 7,
    };
}

describe('Generic consumable protocol TypeScript migration', () => {
    it('preserves detection against the complete existing object and command catalogs', () => {
        const values = createConsumableValues();
        const legacy = legacyProtocol.detectConsumables(values, objects.stockConsumable.list, commands);
        const typed = typedProtocol.detectConsumables(values, objects.stockConsumable.list, commands);

        assert.deepEqual(typed, legacy);
        assert.deepEqual(
            typed.map(feature => feature.id),
            ['filter', 'main_brush', 'mop_pad', 'sensors', 'side_brush', 'water_filter', 'strainer', 'dust_collection'],
        );
        assert.equal(typed.some(feature => feature.id === 'cleaning_brush'), false);
    });

    it('preserves zero values while excluding missing, null, and undefined values', () => {
        const scenarios = [
            { filter_work_time: 0 },
            { filter_work_time: null },
            { filter_work_time: undefined },
            {},
        ];

        for (const values of scenarios) {
            assert.deepEqual(
                typedProtocol.detectConsumables(values, objects.stockConsumable.list, commands),
                legacyProtocol.detectConsumables(values, objects.stockConsumable.list, commands),
            );
        }
        assert.equal(typedProtocol.detectConsumables(scenarios[0], objects.stockConsumable.list, commands).length, 1);
        assert.equal(typedProtocol.detectConsumables(scenarios[1], objects.stockConsumable.list, commands).length, 0);
    });

    it('preserves percentage calculation, negative lifetime, and raw counters', () => {
        const values = createConsumableValues();
        const features = typedProtocol.detectConsumables(values, objects.stockConsumable.list, commands);

        for (const feature of features) {
            assert.equal(
                typedProtocol.calculateConsumableValue(values, feature),
                legacyProtocol.calculateConsumableValue(values, feature),
            );
        }
        assert.equal(typedProtocol.calculateConsumableValue(values, features[0]), 99);
        assert.equal(
            typedProtocol.calculateConsumableValue({ filter_work_time: 600000 }, features[0]),
            -11,
        );
        const strainer = features.find(feature => feature.id === 'strainer');
        assert.ok(strainer);
        assert.equal(
            typedProtocol.calculateConsumableValue(values, strainer),
            12,
        );
    });
});
