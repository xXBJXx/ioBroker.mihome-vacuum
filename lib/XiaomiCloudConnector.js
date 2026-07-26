const axios = require('axios');
const crypto = require('crypto');
const qs = require('qs');

const QR_LOGIN_URL = 'https://account.xiaomi.com/longPolling/loginUrl';
const LONG_POLL_TIMEOUT_MS = 10 * 1000;

/** Xiaomi Cloud authentication and encrypted API client. */
class XiaomiCloudConnector {
    constructor(logger, authObj = {}, adapter) {
        this.logger = logger;
        this.adapter = adapter;
        this.session = axios.create({ timeout: 15_000, maxRedirects: 0, validateStatus: () => true });
        this.agent = this.generateAgent();
        this.deviceId = this.generateDeviceId();
        this.commonCookies = '';
        this.sessionCookies = '';
        this.ssecurity = null;
        this.userId = null;
        this.location = null;
        this.serviceToken = null;
        this.homeIds = null;
        this.loginInProgress = false;
        this.unloaded = false;
        this.abortController = null;
        this.init(authObj);
    }

    init(authObj = {}) {
        if (authObj.deviceId) {
            this.deviceId = authObj.deviceId;
        }
        this.commonCookies = `sdkVersion=accountsdk-18.8.15; deviceId=${this.deviceId};`;
        const storedSession = authObj.cloudSession || this.adapter?.config?.cloudSession;
        if (storedSession && !this.restoreSession(storedSession)) {
            this.clearPersistedSession().catch(() => undefined);
        }
    }

    restoreSession(rawSession) {
        if (!rawSession) {
            return false;
        }
        try {
            const saved = typeof rawSession === 'string' ? JSON.parse(rawSession) : rawSession;
            if (!this.isValidSession(saved)) {
                return false;
            }
            this.deviceId = saved.deviceId || this.deviceId;
            this.commonCookies = `sdkVersion=accountsdk-18.8.15; deviceId=${this.deviceId};`;
            this.ssecurity = saved.ssecurity;
            this.userId = saved.userId;
            this.location = saved.location;
            this.serviceToken = saved.serviceToken;
            this.sessionCookies = saved.sessionCookies || '';
            this.updateAuth('authenticated');
            return true;
        } catch {
            return false;
        }
    }

    isValidSession(session) {
        return !!(
            session &&
            typeof session.ssecurity === 'string' &&
            session.ssecurity.length >= 16 &&
            /^[A-Za-z0-9+/]+={0,2}$/.test(session.ssecurity) &&
            typeof session.userId === 'string' &&
            session.userId.length > 0 &&
            typeof session.serviceToken === 'string' &&
            session.serviceToken.length >= 8 &&
            typeof session.location === 'string' &&
            session.location.startsWith('https://')
        );
    }

    loggedIn() {
        return this.isValidSession(this.exportSession());
    }

    exportSession() {
        return {
            deviceId: this.deviceId,
            sessionCookies: this.sessionCookies,
            ssecurity: this.ssecurity,
            userId: this.userId,
            location: this.location,
            serviceToken: this.serviceToken,
        };
    }

    async persistSession() {
        if (!this.adapter || this.unloaded) {
            return;
        }
        const objectId = `system.adapter.${this.adapter.namespace}`;
        const obj = await this.adapter.getForeignObjectAsync(objectId);
        if (!obj) {
            throw new Error('Adapter configuration is unavailable');
        }
        obj.native = { ...obj.native, cloudSession: JSON.stringify(this.exportSession()) };
        await this.adapter.setForeignObjectAsync(objectId, obj);
    }

    async clearPersistedSession() {
        if (!this.adapter || this.unloaded) {
            return;
        }
        const objectId = `system.adapter.${this.adapter.namespace}`;
        const obj = await this.adapter.getForeignObjectAsync(objectId);
        if (!obj) {
            return;
        }
        obj.native = { ...obj.native, cloudSession: '' };
        await this.adapter.setForeignObjectAsync(objectId, obj);
    }

    async updateAuth(status, options = {}) {
        if (!this.adapter || this.unloaded) {
            return;
        }
        try {
            await this.adapter.setStateAsync('auth.status', status, true);
            if (options.loginUrl !== undefined) {
                await this.adapter.setStateAsync('auth.loginUrl', options.loginUrl, true);
            }
            if (options.lastError !== undefined) {
                await this.adapter.setStateAsync('auth.lastError', options.lastError, true);
            }
            if (options.expiresAt !== undefined) {
                await this.adapter.setStateAsync('auth.expiresAt', options.expiresAt, true);
            }
        } catch {
            // The adapter may be shutting down or its database may already be closed.
        }
    }

    mergeSetCookie(setCookie) {
        if (!Array.isArray(setCookie)) {
            return;
        }
        const cookies = new Map(
            this.sessionCookies
                .split(';')
                .map(value => value.trim())
                .filter(Boolean)
                .map(value => value.split(/=(.*)/s).slice(0, 2)),
        );
        for (const header of setCookie) {
            const [name, value] = String(header).split(';')[0].split(/=(.*)/s);
            if (name && value !== undefined) {
                cookies.set(name.trim(), value.trim());
            }
        }
        this.sessionCookies = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }

    buildCookieHeader() {
        return [this.commonCookies, 'pass_ua=web', 'uLocale=en_GB', this.sessionCookies].filter(Boolean).join('; ');
    }

    async startQrLogin() {
        if (this.unloaded) {
            return { err: 'Adapter is stopping' };
        }
        if (this.loggedIn()) {
            return { ok: true };
        }
        if (this.loginInProgress) {
            return { pending: true };
        }

        this.loginInProgress = true;
        this.abortController = new AbortController();
        await this.updateAuth('waiting_for_scan', { lastError: '' });
        try {
            const response = await this.session.get(QR_LOGIN_URL, {
                params: {
                    _qrsize: '480',
                    qs: '%3Fsid%3Dxiaomiio%26_json%3Dtrue',
                    callback: 'https://sts.api.io.mi.com/sts',
                    _hasLogo: 'false',
                    sid: 'xiaomiio',
                    _locale: 'en_GB',
                    _dc: Date.now().toString(),
                },
                headers: { 'User-Agent': this.agent, Accept: '*/*' },
                signal: this.abortController.signal,
            });
            const data = this.parseJSON(response.data);
            if (response.status !== 200 || !data?.loginUrl || !data?.lp) {
                throw new Error('Invalid Xiaomi QR login response');
            }

            this.qrLoginUrl = data.loginUrl;
            this.longPollingUrl = data.lp;
            this.qrExpiresAt = Date.now() + Math.max(1, Number.parseInt(data.timeout, 10) || 300) * 1000;
            await this.updateAuth('waiting_for_scan', {
                loginUrl: this.qrLoginUrl,
                expiresAt: this.qrExpiresAt,
            });
            this.waitForQrLogin().catch(error => this.finishQrLoginError(error));
            return { pending: true, loginUrl: this.qrLoginUrl };
        } catch (error) {
            this.loginInProgress = false;
            const message = this.safeError(error);
            await this.updateAuth('error', { lastError: message });
            return { err: message };
        }
    }

    async waitForQrLogin() {
        while (!this.unloaded && Date.now() < this.qrExpiresAt) {
            try {
                const response = await this.session.get(this.longPollingUrl, {
                    timeout: LONG_POLL_TIMEOUT_MS,
                    signal: this.abortController?.signal,
                    headers: { 'User-Agent': this.agent, Cookie: this.buildCookieHeader() },
                });
                const data = this.parseJSON(response.data);
                if (response.status === 200 && data?.userId && data?.ssecurity && data?.location) {
                    this.userId = String(data.userId);
                    this.ssecurity = data.ssecurity;
                    this.location = data.location;
                    await this.updateAuth('waiting_for_confirmation');
                    await this.fetchServiceToken();
                    await this.persistSession();
                    this.loginInProgress = false;
                    await this.updateAuth('authenticated', { loginUrl: '', lastError: '', expiresAt: 0 });
                    return;
                }
                if (response.status === 401 || response.status === 403) {
                    throw new Error('Xiaomi rejected the QR login');
                }
                await this.delay(500);
            } catch (error) {
                if (this.unloaded || error.code === 'ERR_CANCELED') {
                    return;
                }
                if (error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
                    // One slow retry prevents a tight loop on transient network failures.
                    await this.delay(2_000);
                }
            }
        }
        if (!this.unloaded) {
            await this.finishQrLoginError(new Error('QR login expired'));
        }
    }

    async fetchServiceToken() {
        const response = await this.session.get(this.location, {
            headers: { 'User-Agent': this.agent, Cookie: this.buildCookieHeader() },
            maxRedirects: 0,
            signal: this.abortController?.signal,
        });
        this.mergeSetCookie(response.headers['set-cookie']);
        const serviceToken = this.sessionCookies
            .split(';')
            .map(cookie => cookie.trim())
            .find(cookie => cookie.startsWith('serviceToken='))
            ?.slice('serviceToken='.length);
        if (response.status < 200 || response.status >= 400 || !serviceToken) {
            throw new Error('Xiaomi did not provide a service token');
        }
        this.serviceToken = serviceToken;
    }

    async finishQrLoginError(error) {
        if (this.unloaded) {
            return;
        }
        this.loginInProgress = false;
        const message = this.safeError(error);
        const expired = message === 'QR login expired';
        await this.updateAuth(expired ? 'expired' : 'error', { lastError: message });
    }

    async login() {
        if (this.loggedIn()) {
            return { ok: true };
        }
        return this.startQrLogin();
    }

    async refreshToken() {
        await this.invalidateSession('not_authenticated');
        return this.startQrLogin();
    }

    async invalidateSession(status = 'not_authenticated') {
        this.ssecurity = null;
        this.userId = null;
        this.location = null;
        this.serviceToken = null;
        this.sessionCookies = '';
        await this.clearPersistedSession();
        await this.updateAuth(status, { loginUrl: '', expiresAt: 0 });
    }

    async getHomes(country) {
        const url = `${this.getApiUrl(country)}/v2/homeroom/gethome`;
        const data = JSON.stringify({ fg: true, fetch_share: true, fetch_share_dev: true, limit: 300, app_ver: 7 });
        const json = await this.executeEncryptedApiCall(url, { data });
        this.homeIds = json?.result?.homelist?.map(home => home.id) || [];
    }

    async getDevices(country, homeIds) {
        if (!homeIds) {
            if (!this.homeIds) {
                await this.getHomes(country);
            }
            homeIds = this.homeIds?.slice() || [];
        } else if (!Array.isArray(homeIds)) {
            homeIds = [homeIds];
        }
        const url = `${this.getApiUrl(country)}/v2/home/home_device_list`;
        const devices = {};
        for (const homeId of homeIds) {
            devices[homeId] = await this.executeEncryptedApiCall(url, {
                data: JSON.stringify({
                    home_owner: this.userId,
                    home_id: homeId,
                    limit: 200,
                    get_split_device: true,
                    support_smart_home: true,
                }),
            });
        }
        return devices;
    }

    async executeEncryptedApiCall(url, params) {
        if (!this.loggedIn()) {
            throw new Error('Xiaomi Cloud authentication required');
        }
        const nonce = this.generateNonce(Date.now());
        const signedNonce = this.signedNonce(nonce, this.ssecurity);
        const fields = this.generateEncryptedParams(
            new XiaomiRC4Cipher(signedNonce),
            url,
            'POST',
            nonce,
            { ...params },
            this.ssecurity,
        );
        try {
            const response = await this.session.post(`${url}?${qs.stringify(fields, { encode: true })}`, null, {
                headers: {
                    'Accept-Encoding': 'identity',
                    'User-Agent': this.agent,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
                    'MIOT-ENCRYPT-ALGORITHM': 'ENCRYPT-RC4',
                    Cookie: `userId=${this.userId}; yetAnotherServiceToken=${this.serviceToken}; serviceToken=${this.serviceToken}; ${this.buildCookieHeader()}`,
                },
            });
            if ([401, 403].includes(response.status)) {
                await this.invalidateSession('not_authenticated');
                throw new Error('Xiaomi Cloud session is no longer authorized');
            }
            if (response.status !== 200) {
                throw new Error(`Xiaomi Cloud request failed (HTTP ${response.status})`);
            }
            return JSON.parse(new XiaomiRC4Cipher(signedNonce).decrypt(response.data).replace('&&&START&&&', ''));
        } catch (error) {
            throw new Error(this.safeError(error));
        }
    }

    parseJSON(raw) {
        try {
            return typeof raw === 'string' ? JSON.parse(raw.replace('&&&START&&&', '')) : raw;
        } catch {
            return null;
        }
    }

    safeError(error) {
        const status = error?.response?.status;
        if (status) {
            return `Xiaomi request failed (HTTP ${status})`;
        }
        if (error?.code === 'ECONNABORTED') {
            return 'Xiaomi request timed out';
        }
        return String(error?.message || 'Xiaomi request failed').replace(/https?:\/\/\S+/g, '[redacted URL]');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    shutdown() {
        this.unloaded = true;
        this.abortController?.abort();
    }
    generateAgent() {
        return `mihome-vacuum/${crypto.randomBytes(8).toString('hex')}`;
    }
    generateDeviceId() {
        return crypto.randomBytes(6).toString('hex').slice(0, 6);
    }
    getApiUrl(country) {
        return `https://${country === 'cn' || country === '-' ? '' : `${country}.`}api.io.mi.com/app`;
    }
    signedNonce(nonce, ssecurity) {
        return crypto
            .createHash('sha256')
            .update(Buffer.concat([Buffer.from(ssecurity, 'base64'), Buffer.from(nonce, 'base64')]))
            .digest('base64');
    }
    generateNonce(millis) {
        const time = Buffer.alloc(4);
        time.writeUInt32BE(Math.floor(millis / 60000), 0);
        return Buffer.concat([crypto.randomBytes(8), time]).toString('base64');
    }
    generateEncSignature(url, method, signedNonce, params) {
        return crypto
            .createHash('sha1')
            .update(
                [
                    method,
                    `/${url.split('/app/')[1]}`,
                    ...Object.entries(params).map(([key, value]) => `${key}=${value}`),
                    signedNonce,
                ].join('&'),
                'utf8',
            )
            .digest('base64');
    }
    generateEncryptedParams(rc4, url, method, nonce, params, ssecurity) {
        params.rc4_hash__ = this.generateEncSignature(url, method, rc4.passwordB64, params);
        for (const [key, value] of Object.entries(params)) {
            params[key] = rc4.encrypt(value);
        }
        params.signature = this.generateEncSignature(url, method, rc4.passwordB64, params);
        params.ssecurity = ssecurity;
        params._nonce = nonce;
        return params;
    }
}

class XiaomiRC4Cipher {
    constructor(passwordB64) {
        this.passwordB64 = passwordB64;
        this.key = Buffer.from(passwordB64, 'base64');
        this.S = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            this.S[i] = i;
        }
        let j = 0;
        for (let i = 0; i < 256; i++) {
            j = (j + this.S[i] + this.key[i % this.key.length]) % 256;
            [this.S[i], this.S[j]] = [this.S[j], this.S[i]];
        }
        this.i = 0;
        this.j = 0;
        for (let drop = 0; drop < 1024; drop++) {
            this.generateKeystreamByte();
        }
    }
    generateKeystreamByte() {
        this.i = (this.i + 1) % 256;
        this.j = (this.j + this.S[this.i]) % 256;
        [this.S[this.i], this.S[this.j]] = [this.S[this.j], this.S[this.i]];
        return this.S[(this.S[this.i] + this.S[this.j]) % 256];
    }
    encrypt(plainText) {
        const input = Buffer.from(String(plainText), 'utf8');
        const output = Buffer.alloc(input.length);
        for (let i = 0; i < input.length; i++) {
            output[i] = input[i] ^ this.generateKeystreamByte();
        }
        return output.toString('base64');
    }
    decrypt(cipherTextB64) {
        const input = Buffer.from(cipherTextB64, 'base64');
        const output = Buffer.alloc(input.length);
        for (let i = 0; i < input.length; i++) {
            output[i] = input[i] ^ this.generateKeystreamByte();
        }
        return output.toString('utf8');
    }
}

module.exports = XiaomiCloudConnector;
