const assert = require('node:assert/strict');
const MapHelper = require('../lib/maphelper');

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
