const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();
const MapHelper = require('../lib/maphelper');
const TypedMapHelper = require('../build/lib/maphelper');

describe('MapHelper logging', () => {
    function createAdapter() {
        return {
            config: {
                enableMiMap: false,
                server: 'de',
            },
            log: {
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
            },
        };
    }

    it('does not log the cloud map location', async () => {
        const debugMessages = [];
        const adapter = {
            config: {
                enableMiMap: false,
                server: 'de',
            },
            log: {
                debug: message => debugMessages.push(String(message)),
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
            },
        };
        const mapHelper = new MapHelper({}, adapter);
        const sensitiveLocationMarker = 'SENSITIVE_MAP_LOCATION_MARKER';

        mapHelper.config.mimap = true;
        mapHelper.getMapURL = async () => ({
            result: {
                expires_time: Math.floor(Date.now() / 1000) + 300,
                url: sensitiveLocationMarker,
            },
        });
        mapHelper.getMapBase64 = async () => 'map-data';

        const result = await mapHelper.updateMap(`map-${Date.now()}`);

        assert.equal(result, 'map-data');
        assert.equal(debugMessages.some(message => message.includes(sensitiveLocationMarker)), false);
    });

    it('shuts down its cloud connector once', async () => {
        const adapter = {
            config: {},
            log: {
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
            },
        };
        const mapHelper = new MapHelper({}, adapter);
        let shutdownCalls = 0;
        mapHelper.cloudConnector.shutdown = () => shutdownCalls++;
        mapHelper.mapUrlCache.set('test-map', {
            expires: Math.floor(Date.now() / 1000) + 300,
            url: 'sensitive-map-url',
        });

        await mapHelper.shutdown();
        await mapHelper.shutdown();

        assert.equal(shutdownCalls, 1);
        assert.equal(mapHelper.mapUrlCache.size, 0);
    });

    it('does not refresh or restart authentication after an ordinary map request error', async () => {
        const adapter = {
            config: { server: 'de' },
            log: {
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
            },
        };
        const mapHelper = new MapHelper({}, adapter);
        let refreshCalls = 0;
        mapHelper.cloudConnector.loggedIn = () => true;
        mapHelper.cloudConnector.executeEncryptedApiCall = async () => {
            throw new Error('synthetic map request failure');
        };
        mapHelper.cloudConnector.refreshToken = async () => {
            refreshCalls++;
            return { err: '' };
        };

        await assert.rejects(mapHelper.getMapURL('test-map'));

        assert.equal(refreshCalls, 0);
    });

    it('keeps cloud map URL caches isolated between adapter instances', async () => {
        const firstMapHelper = new MapHelper({}, createAdapter());
        const secondMapHelper = new MapHelper({}, createAdapter());
        const mapName = `shared-map-${Date.now()}`;
        let firstUrlRequests = 0;
        let secondUrlRequests = 0;

        firstMapHelper.config.mimap = true;
        secondMapHelper.config.mimap = true;
        firstMapHelper.getMapURL = async () => {
            firstUrlRequests++;
            return {
                result: {
                    expires_time: Math.floor(Date.now() / 1000) + 300,
                    url: 'first-instance-map-url',
                },
            };
        };
        secondMapHelper.getMapURL = async () => {
            secondUrlRequests++;
            return {
                result: {
                    expires_time: Math.floor(Date.now() / 1000) + 300,
                    url: 'second-instance-map-url',
                },
            };
        };
        firstMapHelper.getMapBase64 = async url => url;
        secondMapHelper.getMapBase64 = async url => url;

        assert.equal(await firstMapHelper.updateMap(mapName), 'first-instance-map-url');
        assert.equal(await secondMapHelper.updateMap(mapName), 'second-instance-map-url');
        assert.equal(firstUrlRequests, 1);
        assert.equal(secondUrlRequests, 1);
    });
});

describe('MapHelper TypeScript migration', () => {
    function createObservedAdapter(config = {}) {
        /** @type {Record<'debug' | 'info' | 'warn' | 'error', string[]>} */
        const logs = { debug: [], info: [], warn: [], error: [] };
        return {
            adapter: {
                config,
                log: {
                    debug: message => logs.debug.push(String(message)),
                    info: message => logs.info.push(String(message)),
                    warn: message => logs.warn.push(String(message)),
                    error: message => logs.error.push(String(message)),
                },
            },
            logs,
        };
    }

    it('preserves configuration parsing and isolated URL caches', async () => {
        const config = {
            devices: JSON.stringify({ did: 'synthetic-device-id' }),
            server: 'de',
            ip: '192.0.2.1',
            enableMiMap: false,
            valetudo_enable: false,
            newmap: true,
        };
        const legacyAdapter = createObservedAdapter(structuredClone(config));
        const typedAdapter = createObservedAdapter(structuredClone(config));
        const legacy = new MapHelper({}, legacyAdapter.adapter);
        const typed = new TypedMapHelper({}, typedAdapter.adapter);

        try {
            assert.deepEqual(typed.config, legacy.config);
            legacy.mapUrlCache.set('legacy-only', { expires: 1, url: 'legacy-url' });
            typed.mapUrlCache.set('typed-only', { expires: 1, url: 'typed-url' });
            assert.equal(typed.mapUrlCache.has('legacy-only'), false);
            assert.equal(legacy.mapUrlCache.has('typed-only'), false);
        } finally {
            await legacy.shutdown();
            await typed.shutdown();
        }
    });

    it('preserves fresh and cached map URL routing without exposing locations', async () => {
        const legacyAdapter = createObservedAdapter({ server: 'de' });
        const typedAdapter = createObservedAdapter({ server: 'de' });
        const legacy = new MapHelper({}, legacyAdapter.adapter);
        const typed = new TypedMapHelper({}, typedAdapter.adapter);
        const sensitiveUrl = 'SENSITIVE_TYPED_MAP_URL';
        let legacyRequests = 0;
        let typedRequests = 0;

        try {
            legacy.config.mimap = true;
            typed.config.mimap = true;
            legacy.getMapURL = async () => {
                legacyRequests++;
                return { result: { expires_time: 9999999999, url: sensitiveUrl } };
            };
            typed.getMapURL = async () => {
                typedRequests++;
                return { message: 'ok', result: { expires_time: 9999999999, url: sensitiveUrl } };
            };
            legacy.getMapBase64 = async url => [url, [], undefined, undefined];
            typed.getMapBase64 = async url => [url, [], undefined, undefined];

            assert.deepEqual(await typed.updateMap('same-map'), await legacy.updateMap('same-map'));
            assert.deepEqual(await typed.updateMap('same-map'), await legacy.updateMap('same-map'));
            assert.equal(typedRequests, legacyRequests);
            assert.equal(typedRequests, 1);
            assert.equal(JSON.stringify(typedAdapter.logs).includes(sensitiveUrl), false);
            assert.equal(JSON.stringify(legacyAdapter.logs).includes(sensitiveUrl), false);
        } finally {
            await legacy.shutdown();
            await typed.shutdown();
        }
    });

    it('redacts HTTP headers and cloud response details from errors and logs', async () => {
        const sensitiveMarker = 'SENSITIVE_HEADER_OR_RESPONSE';
        const axiosStub = {
            get: async () => ({ status: 404, data: Buffer.alloc(0), headers: { private: sensitiveMarker } }),
        };
        const FakeCloudConnector = class {
            loggedIn() {
                return true;
            }
            shutdown() {}
        };
        const LegacyWithMocks = proxyquire('../lib/maphelper', {
            axios: { default: axiosStub, ...axiosStub },
            './XiaomiCloudConnector': FakeCloudConnector,
        });
        const TypedWithMocks = proxyquire('../build/lib/maphelper', {
            axios: { default: axiosStub, ...axiosStub },
            '../../lib/XiaomiCloudConnector': FakeCloudConnector,
        });
        const legacyAdapter = createObservedAdapter({});
        const typedAdapter = createObservedAdapter({});
        const legacy = new LegacyWithMocks({}, legacyAdapter.adapter);
        const typed = new TypedWithMocks({}, typedAdapter.adapter);

        try {
            await assert.rejects(legacy.getRawMapData(), error => !String(error).includes(sensitiveMarker));
            await assert.rejects(typed.getRawMapData(), error => !String(error).includes(sensitiveMarker));
            legacy.cloudConnector.executeEncryptedApiCall = async () => ({ message: sensitiveMarker });
            typed.cloudConnector.executeEncryptedApiCall = async () => ({ message: sensitiveMarker });
            await assert.rejects(legacy.getMapURL('map'), error => !String(error).includes(sensitiveMarker));
            await assert.rejects(typed.getMapURL('map'), error => !String(error).includes(sensitiveMarker));
            assert.equal(JSON.stringify(legacyAdapter.logs).includes(sensitiveMarker), false);
            assert.equal(JSON.stringify(typedAdapter.logs).includes(sensitiveMarker), false);
        } finally {
            await legacy.shutdown();
            await typed.shutdown();
        }
    });
});
