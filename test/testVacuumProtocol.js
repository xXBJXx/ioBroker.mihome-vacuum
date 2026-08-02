const assert = require('node:assert/strict');
const LegacyProtocol = require('../lib/vacuumProtocol');
const TypedProtocol = require('../build/lib/vacuumProtocol');

describe('Generic vacuum protocol TypeScript migration', () => {
    it('preserves every translation, error, cleaning state, resume command, and carpet default', () => {
        assert.deepEqual(TypedProtocol.i18n, LegacyProtocol.i18n);
        assert.deepEqual(TypedProtocol.errorTexts, LegacyProtocol.errorTexts);
        assert.deepEqual(TypedProtocol.cleanStates, LegacyProtocol.cleanStates);
        assert.deepEqual(TypedProtocol.activeCleanStates, LegacyProtocol.activeCleanStates);
        assert.deepEqual(TypedProtocol.defaultCarpetModeSettings, LegacyProtocol.defaultCarpetModeSettings);
    });

    it('keeps all model-independent active states paired with valid cleaning states', () => {
        /** @type {Set<number>} */
        const knownStates = new Set(Object.values(TypedProtocol.cleanStates));

        for (const [state, definition] of Object.entries(TypedProtocol.activeCleanStates)) {
            assert.equal(knownStates.has(Number(state)), true);
            assert.equal(typeof definition.name, 'string');
            if (definition.resume !== undefined) {
                assert.equal(typeof definition.resume, 'string');
            }
        }
        assert.equal(TypedProtocol.cleanStates.Cleaning, 5);
        assert.equal(TypedProtocol.cleanStates.RoomCleaning, 18);
        assert.equal(TypedProtocol.activeCleanStates[17].resume, 'resume_zoned_clean');
        assert.equal(TypedProtocol.activeCleanStates[18].resume, 'resume_segment_clean');
    });

    it('keeps fresh carpet settings isolated per manager-style copy', () => {
        const first = { ...TypedProtocol.defaultCarpetModeSettings };
        const second = { ...TypedProtocol.defaultCarpetModeSettings };

        first.enabled = 0;

        assert.equal(second.enabled, 1);
        assert.deepEqual(second, LegacyProtocol.defaultCarpetModeSettings);
    });
});
