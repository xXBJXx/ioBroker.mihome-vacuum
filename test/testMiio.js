const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');

class FakeSocket extends EventEmitter {
    constructor() {
        super();
        this.closeCalls = 0;
        this.sentPackets = [];
        this.deferSendCallback = false;
        this.pendingSendCallbacks = [];
    }

    bind() {}

    close(callback) {
        this.closeCalls++;
        this.emit('close');
        if (callback) callback();
    }

    send(...args) {
        this.sentPackets.push(args[0]);
        const callback = args[args.length - 1];
        if (typeof callback === 'function') {
            if (this.deferSendCallback) {
                this.pendingSendCallbacks.push(callback);
            } else {
                callback();
            }
        }
    }

    address() {
        return { address: 'test-host', port: 12345 };
    }
}

function createClient() {
    const socket = new FakeSocket();
    const connectionStates = [];
    /** @type {Record<string, string[]>} */
    const logs = { debug: [], info: [], warn: [], error: [] };
    const adapter = {
        config: {
            ownPort: 53421,
            port: 54321,
            ip: 'test-host',
            token: '00000000000000000000000000000000',
        },
        log: Object.fromEntries(
            Object.keys(logs).map(level => [level, message => logs[level].push(String(message))]),
        ),
        setConnection: connected => connectionStates.push(connected),
    };
    const Miio = proxyquire('../lib/miio', {
        dgram: {
            createSocket: () => socket,
        },
    });
    const client = new Miio(adapter);
    let answer = {};
    client.connected = true;
    client.packet.msgCounter = 1;
    client.packet.getRaw_fast = () => Buffer.from('request');
    client.packet.setRaw = () => undefined;
    client.packet.getPlainData = () => JSON.stringify(answer);

    return {
        client,
        socket,
        connectionStates,
        logs,
        answer(id, result = ['ok']) {
            answer = { id, result };
            socket.emit('message', Buffer.alloc(33), { port: 54321 });
        },
    };
}

describe('Miio lifecycle', () => {
    it('keeps response handling isolated between adapter instances', async () => {
        const sockets = [new FakeSocket(), new FakeSocket()];
        let socketIndex = 0;
        const Miio = proxyquire('../lib/miio', {
            dgram: {
                createSocket: () => sockets[socketIndex++],
            },
        });
        const createAdapter = () => {
            const connectionStates = [];
            return {
                config: {
                    ownPort: 53421,
                    port: 54321,
                    ip: 'test-host',
                    token: '00000000000000000000000000000000',
                },
                connectionStates,
                log: {
                    debug: () => undefined,
                    info: () => undefined,
                    warn: () => undefined,
                    error: () => undefined,
                },
                setConnection: connected => connectionStates.push(connected),
            };
        };
        const firstAdapter = createAdapter();
        const secondAdapter = createAdapter();
        const firstClient = new Miio(firstAdapter);
        const secondClient = new Miio(secondAdapter);
        firstClient.connected = true;
        firstClient.packet.msgCounter = 1;
        firstClient.packet.getRaw_fast = () => Buffer.from('request');
        firstClient.packet.setRaw = () => undefined;
        firstClient.packet.getPlainData = () => JSON.stringify({ id: 1, result: ['ok'] });

        const response = firstClient.sendMessage('get_status');
        sockets[0].emit('message', Buffer.alloc(33), { port: 54321 });

        assert.deepEqual(await response, { id: 1, result: ['ok'] });
        assert.deepEqual(firstAdapter.connectionStates, [true]);
        assert.deepEqual(secondAdapter.connectionStates, []);
        firstClient.close();
        secondClient.close();
    });

    it('does not log the complete hello packet', () => {
        const { client, socket, logs } = createClient();
        const helloPacket = Buffer.alloc(32, 0xab);
        client.connected = null;
        client.packet.stamprec = Buffer.alloc(4);

        client.__sendPing();
        socket.emit('message', helloPacket, { port: 54321 });

        assert.equal(logs.debug.includes('MIIO hello received'), true);
        assert.equal(logs.debug.some(message => message.includes(helloPacket.toString('hex'))), false);
        client.close();
    });

    it('closes a failed UDP socket without terminating the process', () => {
        const exit = sinon.stub(process, 'exit');
        try {
            const { client, socket, connectionStates } = createClient();

            socket.emit('error', new Error('synthetic UDP failure'));

            assert.equal(exit.called, false);
            assert.equal(client.connected, false);
            assert.deepEqual(connectionStates, [false]);
            assert.equal(socket.closeCalls, 1);
        } finally {
            exit.restore();
        }
    });

    it('closes the UDP socket once and invokes every close callback once', () => {
        const { client, socket } = createClient();
        let firstCallbackCalls = 0;
        let secondCallbackCalls = 0;

        client.close(() => firstCallbackCalls++);
        client.close(() => secondCallbackCalls++);

        assert.equal(firstCallbackCalls, 1);
        assert.equal(secondCallbackCalls, 1);
        assert.equal(socket.closeCalls, 1);
    });
});

describe('Miio request lifecycle', () => {
    let clock;

    beforeEach(() => {
        clock = sinon.useFakeTimers({ now: 1000 });
    });

    afterEach(() => {
        clock.restore();
    });

    it('clears timeout and listener when an answer arrives before timeout', async () => {
        const fixture = createClient();
        const response = fixture.client.sendMessage('get_status', ['PRIVATE_PAYLOAD_MARKER']);

        await clock.tickAsync(100);
        fixture.answer(1);
        assert.deepEqual(await response, { id: 1, result: ['ok'] });
        await clock.tickAsync(3000);

        assert.equal(fixture.socket.listenerCount('message'), 0);
        assert.equal(fixture.logs.debug.some(message => message.includes('timed out')), false);
        assert.equal(fixture.logs.debug.some(message => message.includes('PRIVATE_PAYLOAD_MARKER')), false);
    });

    it('accepts an answer directly before timeout', async () => {
        const fixture = createClient();
        const response = fixture.client.sendMessage('get_status');

        await clock.tickAsync(1999);
        fixture.answer(1);

        assert.deepEqual(await response, { id: 1, result: ['ok'] });
        assert.equal(fixture.logs.debug.some(message => message.includes('timed out')), false);
    });

    it('times out once with safe request context', async () => {
        const fixture = createClient();
        const response = fixture.client.sendMessage('get_status');

        await clock.tickAsync(2000);

        assert.deepEqual(await response, {});
        assert.equal(
            fixture.logs.debug.includes(
                'MIIO request timed out: method=get_status, id=1, duration=2000ms, timeout=2000ms',
            ),
            true,
        );
        assert.equal(fixture.socket.listenerCount('message'), 0);
    });

    it('ignores a late answer after timeout', async () => {
        const fixture = createClient();
        const response = fixture.client.sendMessage('get_status');

        await clock.tickAsync(2000);
        assert.deepEqual(await response, {});
        fixture.answer(1, ['late']);

        assert.equal(fixture.socket.listenerCount('message'), 0);
        assert.deepEqual(fixture.connectionStates, []);
    });

    it('keeps parallel requests separate by message ID', async () => {
        const fixture = createClient();
        const first = fixture.client.sendMessage('get_status');
        const second = fixture.client.sendMessage('get_sound_volume');
        let firstSettled = false;
        first.then(() => (firstSettled = true));

        fixture.answer(2, ['second']);
        assert.deepEqual(await second, { id: 2, result: ['second'] });
        await Promise.resolve();
        assert.equal(firstSettled, false);

        fixture.answer(1, ['first']);
        assert.deepEqual(await first, { id: 1, result: ['first'] });
        assert.equal(fixture.socket.listenerCount('message'), 0);
    });

    it('settles and removes the listener on shutdown during a request', async () => {
        const fixture = createClient();
        fixture.socket.deferSendCallback = true;
        const response = fixture.client.sendMessage('get_status');

        fixture.client.close();
        const sendCallback = fixture.socket.pendingSendCallbacks.shift();
        assert.equal(typeof sendCallback, 'function');
        sendCallback();
        await clock.tickAsync(3000);

        assert.deepEqual(await response, {});
        assert.equal(fixture.socket.listenerCount('message'), 0);
        assert.equal(fixture.logs.debug.some(message => message.includes('timed out')), false);
    });

    it('does not start or log another request after shutdown', async () => {
        const fixture = createClient();

        fixture.client.close();
        const sentPackets = fixture.socket.sentPackets.length;
        const debugMessages = fixture.logs.debug.length;
        const errorMessages = fixture.logs.error.length;

        assert.deepEqual(await fixture.client.sendMessage('get_status'), {});
        assert.equal(fixture.socket.sentPackets.length, sentPackets);
        assert.equal(fixture.logs.debug.length, debugMessages);
        assert.equal(fixture.logs.error.length, errorMessages);
    });

    it('ignores an answer with the wrong message ID until timeout', async () => {
        const fixture = createClient();
        const response = fixture.client.sendMessage('get_status');
        let settled = false;
        response.then(() => (settled = true));

        fixture.answer(99);
        await Promise.resolve();
        assert.equal(settled, false);
        await clock.tickAsync(2000);

        assert.deepEqual(await response, {});
    });

    it('settles and removes the listener on socket error', async () => {
        const fixture = createClient();
        const response = fixture.client.sendMessage('get_status');

        fixture.socket.emit('error', new Error('synthetic UDP failure'));

        assert.deepEqual(await response, {});
        assert.equal(fixture.socket.listenerCount('message'), 0);
        assert.equal(fixture.socket.closeCalls, 1);
    });
});
