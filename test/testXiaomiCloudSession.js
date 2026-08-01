const assert = require('node:assert/strict');
const LegacySession = require('../lib/XiaomiCloudSession');
const TypedSession = require('../build/lib/XiaomiCloudSession');
const XiaomiCloudConnector = require('../lib/XiaomiCloudConnector');

describe('Xiaomi Cloud session TypeScript migration', () => {
    function createValidSession() {
        return {
            deviceId: 'synthetic-device',
            ssecurity: Buffer.alloc(16, 1).toString('base64'),
            userId: 'synthetic-user',
            serviceToken: 'synthetic-service-token',
            location: 'https://login.example/synthetic-session',
            sessionCookies: 'syntheticCookie=synthetic-value',
        };
    }

    it('accepts the complete synthetic session contract', () => {
        const session = createValidSession();

        assert.equal(LegacySession.isValidCloudSession(session), true);
        assert.equal(TypedSession.isValidCloudSession(session), true);
    });

    it('rejects every missing or malformed required field in parity', () => {
        const invalidSessions = [
            null,
            '',
            {},
            { ...createValidSession(), ssecurity: 'short' },
            { ...createValidSession(), ssecurity: 'not base64!' },
            { ...createValidSession(), userId: '' },
            { ...createValidSession(), serviceToken: 'short' },
            { ...createValidSession(), sessionCookies: '' },
            { ...createValidSession(), location: 'http://insecure.example/session' },
        ];

        for (const session of invalidSessions) {
            assert.equal(TypedSession.isValidCloudSession(session), LegacySession.isValidCloudSession(session));
            assert.equal(TypedSession.isValidCloudSession(session), false);
        }
    });

    it('keeps the connector compatibility method delegated to the extracted validator', () => {
        const connector = new XiaomiCloudConnector(
            { debug() {}, info() {}, warn() {}, error() {} },
            {},
            { config: {} },
        );
        const session = createValidSession();

        assert.equal(connector.isValidSession(session), LegacySession.isValidCloudSession(session));
        assert.equal(connector.isValidSession({ ...session, sessionCookies: '' }), false);
    });
});
