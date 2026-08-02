const assert = require('node:assert/strict');
const legacyProtocol = require('../lib/carpetModeProtocol');
const typedProtocol = require('../build/lib/carpetModeProtocol');

describe('Generic carpet-mode protocol TypeScript migration', () => {
    it('preserves enabled and disabled settings including model-specific fields', () => {
        const responses = [
            { result: [{ enable: 1, current_integral: 450, stall_time: 10, decay_start_time: 3 }] },
            { result: [{ enable: 0, current_integral: 500 }] },
        ];

        for (const response of responses) {
            assert.deepEqual(typedProtocol.parseCarpetMode(response), legacyProtocol.parseCarpetMode(response));
            assert.equal(
                typedProtocol.isCarpetModeSupported(response),
                legacyProtocol.isCarpetModeSupported(response),
            );
        }
        const enabled = typedProtocol.parseCarpetMode(responses[0]);
        const disabled = typedProtocol.parseCarpetMode(responses[1]);
        assert.ok(enabled);
        assert.ok(disabled);
        assert.equal(enabled.enabled, true);
        assert.equal(disabled.enabled, false);
    });

    it('preserves the original settings-object reference', () => {
        const settings = { enable: 1, synthetic: true };
        const parsed = typedProtocol.parseCarpetMode({ result: [settings] });

        assert.ok(parsed);
        assert.equal(parsed.settings, settings);
    });

    it('preserves differing support and value-validation tolerance', () => {
        const responses = [
            { result: [{ enable: 2 }] },
            { result: [{ enable: true }] },
            { result: [] },
            { result: 'unknown_method' },
            {},
            { result: null },
        ];

        for (const response of responses) {
            assert.equal(
                typedProtocol.isCarpetModeSupported(response),
                legacyProtocol.isCarpetModeSupported(response),
            );
        }
        assert.equal(typedProtocol.isCarpetModeSupported(responses[2]), true);
        assert.equal(typedProtocol.isCarpetModeSupported(responses[3]), false);
        assert.equal(typedProtocol.parseCarpetMode(responses[0]), null);
        assert.equal(typedProtocol.parseCarpetMode(responses[1]), null);
        assert.throws(() => legacyProtocol.parseCarpetMode(responses[2]), TypeError);
        assert.throws(() => typedProtocol.parseCarpetMode(responses[2]), TypeError);
    });
});
