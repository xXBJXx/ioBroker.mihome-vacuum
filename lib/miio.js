'use strict';
/* eslint-disable jsdoc/check-tag-names */
const crypto = require('crypto');
const dgram = require('dgram');
const EventEmitter = require('events');

const pingMsg = _str2hex('21310020ffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

class Miio extends EventEmitter {
    constructor(adapterInstance) {
        super();
        this.adapter = adapterInstance;

        this.ownPort = this.adapter.config.ownPort || 53421; //Standard Port
        this.port = this.adapter.config.port || 54321; //Standard Port
        this.ip = this.adapter.config.ip; //
        this.token = _str2hex(this.adapter.config.token); // convert to Hexstring

        this.adapter.log.debug('MIIO: Configured local UDP connection');

        this.connected = null;
        this.closing = false;
        this.closeStarted = false;
        this.closeComplete = false;
        this.closeCallbacks = [];
        this.pingTimeout = 10000; //60000;
        this.packet = new _Packet(this.token);
        this.timeout = null;

        this.globalTimeouts = {};

        this.server = dgram.createSocket('udp4');

        try {
            this.server.bind(this.ownPort);
        } catch (e) {
            return this.adapter.log.error(`Cannot open UDP port, please make sure port is not in use: ${e}`);
        }

        this.server.on('listening', () => {
            const address = this.server.address();
            this.adapter.log.debug(`server started on ${address.address}:${address.port}`);
            this.__sendPing();
        });

        this.server.on('error', err => {
            this.adapter.log.error(`UDP error: ${err}`);
            this.connected = false;
            this.closing = true;
            this.adapter.setConnection(false);
            try {
                this.server.close();
            } catch (err) {
                this.adapter.log.debug(err);
            }
        });
        this.server.on('close', () => {
            if (this.closing) {
                this.adapter.log.debug('UDP socket closed');
            } else {
                this.adapter.log.warn('UDP socket closed unexpectedly');
            }
            Object.keys(this.globalTimeouts).forEach(
                id => this.globalTimeouts[id] && clearTimeout(this.globalTimeouts[id]),
            );
            this.globalTimeouts = {};
        });
    }

    close(callback) {
        if (typeof callback === 'function') {
            if (this.closeComplete) {
                callback();
                return;
            }
            this.closeCallbacks.push(callback);
        }
        if (this.closeStarted) {
            return;
        }
        this.closeStarted = true;
        this.closing = true;
        this.connected = false;
        Object.keys(this.globalTimeouts).forEach(
            id => this.globalTimeouts[id] && clearTimeout(this.globalTimeouts[id]),
        );
        this.globalTimeouts = {};

        const finishClose = () => {
            if (this.closeComplete) {
                return;
            }
            this.closeComplete = true;
            const callbacks = this.closeCallbacks.splice(0);
            callbacks.forEach(closeCallback => closeCallback());
        };

        if (this.server) {
            this.globalTimeouts['nextPing'] && clearTimeout(this.globalTimeouts['nextPing']);
            this.globalTimeouts['pingTimeout'] && clearTimeout(this.globalTimeouts['pingTimeout']);
            try {
                this.server.close(finishClose);
            } catch (err) {
                this.adapter.log.debug(err);
                finishClose();
            }
            return;
        }

        finishClose();
    }

    __sendPing() {
        const checkAnswer = (msg, rinfo) => {
            if (msg.length === 32 && rinfo.port === parseInt(this.port)) {
                clearTimeout(this.globalTimeouts['pingTimeout']);
                clearTimeout(this.globalTimeouts['nextPing']);

                this.adapter.log.debug('MIIO hello received');
                this.server.removeListener('message', checkAnswer);

                // Synchronize the device header and clock before the connect listener
                // builds its first encrypted request.
                this.packet.setRaw(msg);
                const now = Math.floor(Date.now() / 1000);
                const messageTime = parseInt(this.packet.stamprec.toString('hex'), 16);
                this.packet.timediff = messageTime - now === -1 ? 0 : messageTime - now;

                if (!this.connected) {
                    const firstConnection = this.connected === null;
                    // The connect listener immediately sends miIO.info. Set the flag first so
                    // that initial request is not discarded as "not connected".
                    this.connected = true;
                    if (firstConnection) {
                        this.emit('connect');
                    }
                }

                if (this.packet.timediff !== 0) {
                    this.adapter.log.debug(
                        `Time difference between Mihome Vacuum and ioBroker: ${this.packet.timediff} sec`,
                    );
                }
                this.globalTimeouts['nextPing'] = setTimeout(() => {
                    this.globalTimeouts['nextPing'] = null;
                    this.__sendPing();
                }, this.pingTimeout);
            }
        };

        this.server.on('message', checkAnswer);

        try {
            this.server.send(pingMsg, 0, pingMsg.length, this.port, this.ip, err => {
                if (err) {
                    this.adapter.log.warn(`Helo message: ${err}`);
                    this.server.removeListener('message', checkAnswer);
                    this.globalTimeouts['nextPing'] = setTimeout(() => {
                        this.globalTimeouts['nextPing'] = null;
                        this.__sendPing();
                    }, this.pingTimeout);
                } else {
                    this.globalTimeouts['pingTimeout'] = setTimeout(() => {
                        this.globalTimeouts['pingTimeout'] = null;
                        this.adapter.log.debug('Helo message Timeout');
                        this.connected = false;
                        this.server.removeListener('message', checkAnswer);
                        this.globalTimeouts['nextPing'] = setTimeout(() => {
                            this.globalTimeouts['nextPing'] = null;
                            this.__sendPing();
                        }, this.pingTimeout);
                    }, 2000);
                }
            });
        } finally {
            // ignore
        }
    }

    /**
     * @async
     * @param method the methode you want to request
     * @param [params] the optional params as array, e.g. ["peter", "Blaubeere"]
     * @returns return a obj with the answer from the robot
     */
    async sendMessage(method, params) {
        const safeMethod = String(method)
            .replace(/[^a-zA-Z0-9_.-]/g, '?')
            .slice(0, 80);
        return new Promise((resolve, reject) => {
            const createRequestError = (code, message) => Object.assign(new Error(message), { code });
            if (this.closing) {
                return reject(createRequestError('MIIO_CLOSED', 'MIIO client is closed'));
            }
            if (!this.connected) {
                this.adapter.log.debug('your device is not connected, but this could be temporary');
                return reject(createRequestError('MIIO_NOT_CONNECTED', 'MIIO device is not connected'));
            }
            if (this.packet.msgCounter > 10000) {
                this.packet.msgCounter = 1;
            }
            const msgCounter = this.packet.msgCounter++;
            const requestMethod = safeMethod;
            const startedAt = Date.now();

            let rawMsg;
            try {
                rawMsg = this.packet.getRaw_fast(this._buildMsg(method, params, msgCounter));
            } catch {
                this.adapter.log.error(`MIIO request failed: method=${safeMethod}`);
                return reject(createRequestError('MIIO_REQUEST_FAILED', 'MIIO request failed'));
            }
            let settled = false;

            const cleanup = () => {
                const timeoutId = `sendMessage${msgCounter}`;
                clearTimeout(this.globalTimeouts[timeoutId]);
                delete this.globalTimeouts[timeoutId];
                this.server.removeListener('message', checkAnswer);
                this.server.removeListener('close', handleClose);
            };
            const finishRequest = (settle, result) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                settle(result);
            };
            const succeedRequest = result => finishRequest(resolve, result);
            const failRequest = (code, message) => finishRequest(reject, createRequestError(code, message));
            const handleClose = () => failRequest('MIIO_SOCKET_CLOSED', 'MIIO socket closed during request');

            const checkAnswer = (msg, rinfo) => {
                if (msg.length !== 32 && rinfo.port === parseInt(this.port)) {
                    this.packet.setRaw(msg);
                    try {
                        const answer = JSON.parse(this.packet.getPlainData());

                        if (answer.id === msgCounter) {
                            //connection is true
                            this.adapter.setConnection(true);
                            this.adapter.log.debug(
                                `MIIO request succeeded: method=${requestMethod}, id=${msgCounter}, duration=${Date.now() - startedAt}ms`,
                            );
                            succeedRequest(answer);
                        }
                    } catch {
                        this.adapter.log.debug(
                            `MIIO response could not be parsed: method=${requestMethod}, id=${msgCounter}, duration=${Date.now() - startedAt}ms`,
                        );
                        return failRequest('MIIO_INVALID_RESPONSE', 'MIIO response could not be parsed');
                    }
                }
            };

            this.server.on('message', checkAnswer);
            this.server.once('close', handleClose);
            this.adapter.log.debug(`MIIO request started: method=${requestMethod}, id=${msgCounter}, duration=0ms`);

            try {
                this.server.send(rawMsg, 0, rawMsg.length, parseInt(this.port), this.adapter.config.ip, err => {
                    if (settled) {
                        return;
                    }
                    if (err) {
                        this.adapter.log.debug(
                            `MIIO request send failed: method=${requestMethod}, id=${msgCounter}, duration=${Date.now() - startedAt}ms`,
                        );
                        return failRequest('MIIO_SEND_FAILED', 'MIIO request could not be sent');
                    }
                    this.globalTimeouts[`sendMessage${msgCounter}`] = setTimeout(
                        cnt => {
                            this.adapter.log.debug(
                                `MIIO request timed out: method=${requestMethod}, id=${cnt}, duration=${Date.now() - startedAt}ms, timeout=2000ms`,
                            );
                            // Some miIO devices retain recently used IDs across client restarts.
                            // Move the next request beyond that replay window without retrying
                            // the current command, which may already have been executed.
                            this.packet.msgCounter += 100;
                            failRequest('MIIO_TIMEOUT', 'MIIO request timed out');
                        },
                        2000,
                        msgCounter,
                    );
                });
            } catch {
                this.adapter.log.error(`MIIO request failed: method=${safeMethod}`);
                return failRequest('MIIO_REQUEST_FAILED', 'MIIO request failed');
            }
        });
    }

    _buildMsg(method, params, msgCounter) {
        const message = {};
        if (method) {
            message.id = msgCounter;
            message.method = method;
            if (!(
                params === '' ||
                params === undefined ||
                params === null ||
                (params instanceof Array && params.length === 1 && params[0] === '')
            )) {
                message.params = params;
            }
        } else {
            this.adapter.log.warn('Could not build message without arguments');
        }
        const messageStr = JSON.stringify(message)
            .replace('["[', '[[')
            .replace(']"]', ']]')
            .replace(/\]","\[/g, '],[');
        return messageStr;
    }
}

/**
 * Module for Cipher or decipher Miio Messages
 *
 * @class
 * @param {Buffer} token token bytes
 */
function _Packet(token) {
    // Properties
    /** @type {Buffer<ArrayBufferLike>} */
    this.magic = Buffer.alloc(2);
    /** @type {Buffer<ArrayBufferLike>} */
    this.len = Buffer.alloc(2);
    /** @type {Buffer<ArrayBufferLike>} */
    this.unknown = Buffer.alloc(4);
    /** @type {Buffer<ArrayBufferLike>} */
    this.serial = Buffer.alloc(4);
    /** @type {Buffer<ArrayBufferLike>} */
    this.stamp = Buffer.alloc(4);
    /** @type {Buffer<ArrayBufferLike>} */
    this.checksum = Buffer.alloc(16);
    /** @type {Buffer<ArrayBufferLike>} */
    this.data = Buffer.alloc(0);
    /** @type {Buffer<ArrayBufferLike>} */
    this.token = Buffer.alloc(16);
    /** @type {Buffer<ArrayBufferLike>} */
    this.key = Buffer.alloc(16);
    /** @type {Buffer<ArrayBufferLike>} */
    this.iv = Buffer.alloc(16);
    //this.plainMessageOut = '';
    this.ioskey = Buffer.from('00000000000000000000000000000000', 'hex');
    // Methods
    this.msgCounter = 1;

    // for Timediff calculation
    /** @type {Buffer<ArrayBufferLike>} */
    this.stamprec = Buffer.alloc(4);
    this.timediff = 0;

    // Functions and internal functions
    this.setHelo = function () {
        this.magic = Buffer.from('2131', 'hex');
        this.len = Buffer.from('0020', 'hex');
        this.unknown = Buffer.from('FFFFFFFF', 'hex');
        this.serial = Buffer.from('FFFFFFFF', 'hex');
        this.stamp = Buffer.from('FFFFFFFF', 'hex');
        this.checksum = Buffer.from('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 'hex');
        this.data = Buffer.alloc(0);
    };

    /**
     * @param {Buffer} iosToken encrypted iOS token
     * @returns {Buffer} decrypted token bytes
     */
    this.setIosToken = function (iosToken) {
        const _iosToken = iosToken.toString('hex');
        const encrypted = Buffer.from(_iosToken.substr(0, 64), 'hex');

        const decipher = crypto.createDecipheriv('aes-128-ecb', this.ioskey, '');
        decipher.setAutoPadding(false);
        const decrypted = decipher.update(encrypted).toString('ascii'); /*+ decipher.final('ascii')*/

        return _str2hex(decrypted);
    };

    /**
     * @this {_Packet}
     * @param {string} plainData JSON request payload
     * @returns {Buffer} encrypted miIO packet
     */
    this.getRaw_fast = function (plainData) {
        const cipher = crypto.createCipheriv('aes-128-cbc', this.key, this.iv);
        const crypted = Buffer.concat([cipher.update(plainData, 'utf8'), cipher.final()]);
        this.data = crypted;
        const stamp = `00000000${(Math.floor(Date.now() / 1000) + this.timediff).toString(16)}`;
        this.stamp = Buffer.from(stamp.substring(stamp.length - 8), 'hex');

        if (this.data.length > 0) {
            this.len = Buffer.from(decimalToHex(this.data.length + 32, 4), 'hex');
            const zwraw = Buffer.from(
                this.magic.toString('hex') +
                    this.len.toString('hex') +
                    this.unknown.toString('hex') +
                    this.serial.toString('hex') +
                    this.stamp.toString('hex') +
                    this.token.toString('hex') +
                    this.data.toString('hex'),
                'hex',
            );
            this.checksum = _md5(zwraw);
        }
        return Buffer.from(
            this.magic.toString('hex') +
                this.len.toString('hex') +
                this.unknown.toString('hex') +
                this.serial.toString('hex') +
                this.stamp.toString('hex') +
                this.checksum.toString('hex') +
                this.data.toString('hex'),
            'hex',
        );
    };

    /**
     * @param {Buffer} raw received miIO packet
     */
    this.setRaw = function (raw) {
        const rawhex = raw.toString('hex');
        this.magic = Buffer.from(rawhex.substr(0, 4), 'hex');
        this.len = Buffer.from(rawhex.substr(4, 4), 'hex');
        this.unknown = Buffer.from(rawhex.substr(8, 8), 'hex');
        this.serial = Buffer.from(rawhex.substr(16, 8), 'hex');

        this.stamprec = Buffer.from(rawhex.substr(24, 8), 'hex');
        this.checksum = Buffer.from(rawhex.substr(32, 32), 'hex');
        this.data = Buffer.from(rawhex.substr(64), 'hex');
    };

    /**
     * @returns {string} decrypted JSON payload
     */
    this.getPlainData = function () {
        const decipher = crypto.createDecipheriv('aes-128-cbc', this.key, this.iv);
        let dec = Buffer.concat([decipher.update(this.data), decipher.final()]).toString('utf8');
        dec = dec.substring(0, dec.length - 1);
        // S7 is different
        if (!dec.endsWith('}')) {
            dec += '}';
        }
        return dec;
    };

    /**
     * @param {import('node:crypto').BinaryLike} data hash input
     * @returns {Buffer} MD5 digest bytes
     */
    function _md5(data) {
        return Buffer.from(crypto.createHash('md5').update(data).digest('hex'), 'hex');
    }

    /**
     * @this {_Packet}
     * @param {Buffer} token token bytes
     */
    this.setToken = function (token) {
        if (token.length === 48) {
            this.token = this.setIosToken(token);
        } else {
            this.token = token;
        }

        this.key = _md5(this.token);
        this.iv = _md5(Buffer.from(this.key.toString('hex') + this.token.toString('hex'), 'hex'));
    };

    //Call Initializer
    this.setHelo();

    if (token) {
        this.setToken(token);
    }
    return this;
}

function decimalToHex(decimal, chars) {
    return (decimal + Math.pow(16, chars)).toString(16).slice(-chars).toUpperCase();
}

/**
 * Convert a normal String value in a Hex string
 *
 * @param str given text
 * @returns converted in Hex
 */
function _str2hex(str) {
    str = str.replace(/\s/g, '');
    const buf = Buffer.alloc(str.length / 2);

    for (let i = 0; i < str.length / 2; i++) {
        buf[i] = parseInt(str[i * 2] + str[i * 2 + 1], 16);
    }
    return buf;
}

//exports.decimalToHex = decimalToHex;
module.exports = Miio;
