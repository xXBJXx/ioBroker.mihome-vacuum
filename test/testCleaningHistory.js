const assert = require('node:assert/strict');
const legacyHistory = require('../lib/cleaningHistory');
const typedHistory = require('../build/lib/cleaningHistory');

describe('Generic cleaning-history TypeScript migration', () => {
    it('preserves modern and legacy cleaning summaries', () => {
        /** @type {import('../src/types/cleaningHistory').CleaningSummaryResponse[]} */
        const responses = [
            {
                result: {
                    clean_time: 25075,
                    clean_area: 376442500,
                    clean_count: 10,
                    records: [1617553319, 1617470350],
                },
            },
            { result: [25075, 376442500, 10, [1617553319, 1617470350]] },
        ];

        for (const response of responses) {
            assert.deepEqual(typedHistory.parseCleaningSummary(response), legacyHistory.parseCleaningSummary(response));
        }
        assert.deepEqual(typedHistory.parseCleaningSummary(responses[0]), {
            clean_time: 25075,
            total_area: 376442500,
            num_cleanups: 10,
            cleaning_record_ids: [1617553319, 1617470350],
        });
    });

    it('preserves modern, legacy, empty, and missing cleaning records', () => {
        /** @type {Array<import('../src/types/cleaningHistory').CleaningRecordsResponse | null>} */
        const responses = [
            {
                result: [
                    {
                        begin: 1617121021,
                        end: 1617135716,
                        duration: 4217,
                        area: 57002500,
                        error: 0,
                        complete: 1,
                        start_type: 2,
                        clean_type: 1,
                    },
                    [1617121021, 1617135716, 4217, 57002500, 3, 0, 1, 2],
                ],
            },
            { result: [] },
            {},
            null,
        ];

        for (const response of responses) {
            assert.deepEqual(typedHistory.parseCleaningRecords(response), legacyHistory.parseCleaningRecords(response));
        }
        assert.deepEqual(typedHistory.parseCleaningRecords(responses[0]), [
            {
                start_time: 1617121021,
                end_time: 1617135716,
                duration: 4217,
                area: 57002500,
                errors: 0,
                completed: true,
                start_type: 2,
                clean_type: 1,
            },
            {
                start_time: 1617121021,
                end_time: 1617135716,
                duration: 4217,
                area: 57002500,
                errors: 3,
                completed: false,
                start_type: 1,
                clean_type: 2,
            },
        ]);
    });

    it('preserves shallow ordered-property equivalence', () => {
        const cases = [
            [[1, 2, 3], [1, 2, 3]],
            [[1, 2, 3], [1, 2, 4]],
            [[1, 2], [1, 2, 3]],
            [{ first: 1, second: 2 }, { first: 1, second: 2 }],
            [{ first: { nested: true } }, { first: { nested: true } }],
        ];

        for (const [first, second] of cases) {
            assert.equal(typedHistory.isEquivalent(first, second), legacyHistory.isEquivalent(first, second));
        }
        assert.equal(typedHistory.isEquivalent(cases[0][0], cases[0][1]), true);
        assert.equal(typedHistory.isEquivalent(cases[4][0], cases[4][1]), false);
    });

    it('preserves the complete HTML history representation', () => {
        const records = [
            {
                Datum: '1.8',
                Start: '09:05',
                Saugzeit: '42 min',
                Fläche: '57.01 m²',
                Error: 0,
                Ende: true,
            },
            {
                Datum: '2.8',
                Start: '18:30',
                Saugzeit: '12 min',
                Fläche: '12.34 m²',
                Error: 3,
                Ende: false,
            },
        ];

        const legacy = legacyHistory.createHtmlTable(records);
        const typed = typedHistory.createHtmlTable(records);

        assert.equal(typed, legacy);
        assert.match(typed, /^<table><colgroup>/);
        assert.equal((typed.match(/<tr>/g) || []).length, 3);
        assert.match(typed, /<td ALIGN="CENTER">false<\/td><\/tr><\/table>$/);
    });
});
