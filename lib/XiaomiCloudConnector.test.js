const { expect } = require('chai');
const axios = require('axios');
const XiaomiCloudConnector = require('./XiaomiCloudConnector');

function createAdapter() {
    const states = new Map();
    const config = { native: {} };
    return {
        config: {},
        namespace: 'mihome-vacuum.0',
        states,
        async setStateAsync(id, value) {
            states.set(id, value);
        },
        async getForeignObjectAsync() {
            return JSON.parse(JSON.stringify(config));
        },
        async setForeignObjectAsync(_id, value) {
            config.native = value.native;
        },
    };
}

describe('XiaomiCloudConnector QR login', () => {
    let originalCreate;

    beforeEach(() => {
        originalCreate = axios.create;
    });

    afterEach(() => {
        axios.create = originalCreate;
    });

    it('publishes a QR login URL and persists a completed session', async () => {
        const adapter = createAdapter();
        const get = async url => {
            if (url.includes('loginUrl')) {
                return {
                    status: 200,
                    data: '&&&START&&&{"loginUrl":"https://login.example/qr","lp":"https://login.example/poll","timeout":"60"}',
                    headers: {},
                };
            }
            if (url.includes('/poll')) {
                return {
                    status: 200,
                    data: {
                        userId: '42',
                        ssecurity: 'YWJjZGVmZ2hpamtsbW5vcA==',
                        location: 'https://login.example/token',
                    },
                    headers: {},
                };
            }
            return { status: 200, data: '', headers: { 'set-cookie': ['serviceToken=token-value-123; Path=/'] } };
        };
        axios.create = () => ({ get, post: async () => ({ status: 200 }) });
        const connector = new XiaomiCloudConnector({ debug() {}, info() {}, warn() {}, error() {} }, {}, adapter);

        const result = await connector.startQrLogin();
        await new Promise(resolve => setImmediate(resolve));

        expect(result).to.include({ pending: true, loginUrl: 'https://login.example/qr' });
        expect(adapter.states.get('auth.status')).to.equal('authenticated');
        expect(adapter.states.get('auth.loginUrl')).to.equal('');
        expect(adapter.states.get('auth.expiresAt')).to.equal(0);
        expect(connector.loggedIn()).to.equal(true);
    });

    it('rejects damaged persisted sessions without making requests', () => {
        const adapter = createAdapter();
        axios.create = () => ({
            get: async () => {
                throw new Error('unexpected request');
            },
            post: async () => ({}),
        });
        const connector = new XiaomiCloudConnector(
            { debug() {}, info() {}, warn() {}, error() {} },
            { cloudSession: '{"ssecurity":"short"}' },
            adapter,
        );

        expect(connector.loggedIn()).to.equal(false);
    });

    it('reports malformed QR responses without exposing their contents', async () => {
        const adapter = createAdapter();
        axios.create = () => ({ get: async () => ({ status: 200, data: { unexpected: 'response' }, headers: {} }), post: async () => ({}) });
        const connector = new XiaomiCloudConnector({ debug() {}, info() {}, warn() {}, error() {} }, {}, adapter);

        const result = await connector.startQrLogin();

        expect(result.err).to.equal('Invalid Xiaomi QR login response');
        expect(adapter.states.get('auth.status')).to.equal('error');
    });

    it('reports QR network failures and redacts URLs from errors', async () => {
        const adapter = createAdapter();
        axios.create = () => ({ get: async () => { throw new Error('request failed https://secret.example/token'); }, post: async () => ({}) });
        const connector = new XiaomiCloudConnector({ debug() {}, info() {}, warn() {}, error() {} }, {}, adapter);

        const result = await connector.startQrLogin();

        expect(result.err).to.equal('request failed [redacted URL]');
        expect(adapter.states.get('auth.lastError')).to.equal('request failed [redacted URL]');
    });

    it('marks an expired QR login without creating another login attempt', async () => {
        const adapter = createAdapter();
        const connector = new XiaomiCloudConnector({ debug() {}, info() {}, warn() {}, error() {} }, {}, adapter);

        await connector.finishQrLoginError(new Error('QR login expired'));

        expect(adapter.states.get('auth.status')).to.equal('expired');
        expect(connector.loginInProgress).to.equal(false);
    });

    it('marks an unauthorized cloud request as unauthenticated', async () => {
        const adapter = createAdapter();
        axios.create = () => ({ get: async () => ({ status: 200 }), post: async () => ({ status: 401, data: '' }) });
        const connector = new XiaomiCloudConnector(
            { debug() {}, info() {}, warn() {}, error() {} },
            {
                cloudSession: JSON.stringify({
                    ssecurity: 'YWJjZGVmZ2hpamtsbW5vcA==',
                    userId: '42',
                    serviceToken: 'token-value-123',
                    location: 'https://login.example/token',
                }),
            },
            adapter,
        );

        let error;
        try {
            await connector.executeEncryptedApiCall('https://api.io.mi.com/app/test', { data: '{}' });
        } catch (caughtError) {
            error = caughtError;
        }
        expect(error.message).to.include('no longer authorized');
        expect(adapter.states.get('auth.status')).to.equal('not_authenticated');
    });

    it('stops long polling during adapter shutdown', async () => {
        const adapter = createAdapter();
        axios.create = () => ({ get: () => new Promise(() => {}), post: async () => ({}) });
        const connector = new XiaomiCloudConnector({ debug() {}, info() {}, warn() {}, error() {} }, {}, adapter);
        connector.loginInProgress = true;
        connector.longPollingUrl = 'https://login.example/poll';
        connector.qrExpiresAt = Date.now() + 60_000;
        connector.abortController = new AbortController();
        connector.shutdown();
        await connector.waitForQrLogin();

        expect(adapter.states.size).to.equal(0);
    });
});
