const assert = require('node:assert/strict');
const legacyStatus = require('../lib/vacuumStatus');
const typedStatus = require('../build/lib/vacuumStatus');

function createStatus(overrides = {}) {
    return {
        state: 8,
        battery: 87,
        clean_time: 600,
        clean_area: 123400,
        error_code: 0,
        in_cleaning: 1,
        fan_power: 104,
        dnd_enabled: 1,
        map_status: 7,
        map_present: 1,
        future_model_property: 'preserved',
        ...overrides,
    };
}

function runParser(parser, status) {
    const response = { result: [status] };
    const result = parser.parseStatus(response);
    return { response, result };
}

describe('Generic vacuum-status TypeScript migration', () => {
    it('preserves normalized flags, error text, and unknown model properties', () => {
        const legacyInput = createStatus();
        const typedInput = createStatus();
        const legacy = runParser(legacyStatus, legacyInput);
        const typed = runParser(typedStatus, typedInput);

        assert.deepEqual(typed.result, legacy.result);
        assert.equal(typed.result.dnd_enabled, true);
        assert.equal(typed.result.in_cleaning, true);
        assert.equal(typed.result.map_present, true);
        assert.equal(typed.result.error_text, 'No error');
        assert.equal(typed.result.future_model_property, 'preserved');
    });

    it('preserves the historical in-place mutation contract', () => {
        const status = createStatus();
        const { response, result } = runParser(typedStatus, status);

        assert.equal(result, status);
        assert.equal(response.result[0], status);
        assert.equal(status.in_cleaning, true);
    });

    it('treats only numeric one as enabled and preserves unknown error codes', () => {
        const scenarios = [
            createStatus({ dnd_enabled: 0, in_cleaning: 0, map_present: 0, error_code: 18 }),
            createStatus({ dnd_enabled: 2, in_cleaning: true, map_present: '1', error_code: 999 }),
        ];

        for (const status of scenarios) {
            const legacy = runParser(legacyStatus, { ...status }).result;
            const typed = runParser(typedStatus, { ...status }).result;
            assert.deepEqual(typed, legacy);
            assert.equal(typed.dnd_enabled, false);
            assert.equal(typed.in_cleaning, false);
            assert.equal(typed.map_present, false);
        }
        assert.equal(runParser(typedStatus, { ...scenarios[0] }).result.error_text, 'Suction fan problem');
        assert.equal(runParser(typedStatus, { ...scenarios[1] }).result.error_text, undefined);
    });
});
