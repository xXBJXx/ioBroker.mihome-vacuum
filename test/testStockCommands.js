const assert = require('node:assert/strict');

const legacyCommands = require('../lib/stockCommands');
const typeScriptCommands = require('../build/lib/stockCommands');

const expectedKeys = [
    'find',
    'start',
    'pause',
    'home',
    'get_status',
    'get_consumable',
    'get_carpet_mode',
    'get_sound_volume',
    'sound_volume',
    'sound_volume_test',
    'fan_power',
    'mop_mode',
    'water_box_mode',
    'clean_summary',
    'miIO_info',
    'clean_record',
    'filter_reset',
    'sensors_reset',
    'main_brush_reset',
    'mop_pad_reset',
    'side_brush_reset',
    'water_filter_reset',
    'strainer_reset',
    'cleaner_filter_reset',
    'dust_collection_reset',
    'spotclean',
    'resumeZoneClean',
    'resumeRoomClean',
    'loadRooms',
    'loadMap',
    'startDustCollect',
    'stopDustCollect',
    'startWashMop',
    'stopWashMop',
];

describe('Stock command TypeScript migration', () => {
    it('preserves every command key and protocol mapping', () => {
        assert.deepEqual(Object.keys(legacyCommands), expectedKeys);
        assert.deepEqual(typeScriptCommands, legacyCommands);
    });

    it('keeps the confirmed S5 control methods unchanged', () => {
        assert.deepEqual(typeScriptCommands.find, { method: 'find_me' });
        assert.deepEqual(typeScriptCommands.start, { method: 'app_start' });
        assert.deepEqual(typeScriptCommands.pause, { method: 'app_pause' });
        assert.deepEqual(typeScriptCommands.home, { method: 'app_charge' });
    });

    it('keeps every consumable reset parameter paired with reset_consumable', () => {
        for (const [key, command] of Object.entries(typeScriptCommands)) {
            if (key.endsWith('_reset')) {
                assert.equal(command.method, 'reset_consumable');
                assert.equal(typeof command.params, 'string');
                assert.notEqual(command.params.length, 0);
            }
        }
    });
});
