const axios = require('axios');
const crypto = require('crypto');
const qs = require('qs');
const {
    signedNonce,
    generateNonce,
    generateEncSignature,
    generateEncryptedParams,
    XiaomiRC4Cipher,
} = require('./XiaomiCloudCrypto');
const { isValidCloudSession } = require('./XiaomiCloudSession');

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
        this.qrLoginUrl = '';
        this.longPollingUrl = '';
        this.qrExpiresAt = 0;
        this.init(authObj);
    }

    init(authObj = {}) {
        if (authObj.deviceId) {
            this.deviceId = authObj.deviceId;
        }
        this.commonCookies = `sdkVersion=accountsdk-18.8.15; deviceId=${this.deviceId};`;
        const storedSession = authObj.cloudSession || this.adapter?.config?.cloudSession;
        const restored = this.restoreSession(storedSession);
        if (storedSession && !restored) {
            // Do not write adapter configuration here: writing native configuration restarts the instance.
            this.logger.debug('Cloud auth: stored session is incomplete or cannot be read; waiting for a new QR login');
        } else if (restored) {
            this.logger.debug('Cloud auth: restored stored session');
        } else {
            this.logger.debug('Cloud auth: no stored session found');
        }
    }

    restoreSession(rawSession) {
        if (!rawSession) {
            return false;
        }
        try {
            let saved = rawSession;
            if (typeof rawSession === 'string') {
                try {
                    saved = JSON.parse(rawSession);
                } catch {
                    // Older development builds wrote plaintext into encryptedNative. Try the raw decrypted value too.
                    saved = JSON.parse(this.adapter?.decrypt ? this.adapter.decrypt(rawSession) : rawSession);
                }
            }
            if (!this.isValidSession(saved)) {
                this.logger.debug('Cloud auth: stored session failed plausibility validation');
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
            this.logger.debug('Cloud auth: stored session is not valid JSON');
            return false;
        }
    }

    isValidSession(session) {
        return isValidCloudSession(session);
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
        const serializedSession = JSON.stringify(this.exportSession());
        obj.native = {
            ...obj.native,
            // encryptedNative only tells ioBroker how to read configuration. Writes through setForeignObjectAsync must encrypt explicitly.
            cloudSession: this.encryptSession(serializedSession),
        };
        await this.adapter.setForeignObjectAsync(objectId, obj);
        this.logger.debug('Cloud auth: session saved to protected adapter configuration');
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
        obj.native = { ...obj.native, cloudSession: this.encryptSession('') };
        await this.adapter.setForeignObjectAsync(objectId, obj);
    }

    encryptSession(serializedSession) {
        if (!this.adapter?.encrypt) {
            throw new Error('Adapter encryption is unavailable');
        }
        return this.adapter.encrypt(serializedSession);
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
        const cookies = new Map();
        for (const value of this.sessionCookies.split(';')) {
            const [name, cookieValue] = value.trim().split(/=(.*)/s);
            if (name && cookieValue !== undefined) {
                cookies.set(name, cookieValue);
            }
        }
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
                this.logger.debug(`Cloud auth: QR login initialization returned HTTP ${response.status}`);
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
                    this.logger.debug('Cloud auth: QR login was confirmed; requesting service token');
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
                    this.logger.debug(`Cloud auth: QR long-poll was rejected with HTTP ${response.status}`);
                    throw new Error('Xiaomi rejected the QR login');
                }
                await this.delay(500);
            } catch (error) {
                const errorCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
                const errorMessage = error instanceof Error ? error.message : '';
                if (this.unloaded || errorCode === 'ERR_CANCELED') {
                    return;
                }
                if (errorCode !== 'ECONNABORTED' && !errorMessage.includes('timeout')) {
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
        let requestUrl = this.location;
        let response;
        for (let redirect = 0; redirect < 6; redirect++) {
            response = await this.session.get(requestUrl, {
                headers: { 'User-Agent': this.agent, Cookie: this.buildCookieHeader() },
                maxRedirects: 0,
                signal: this.abortController?.signal,
            });
            this.mergeSetCookie(response.headers['set-cookie']);
            const serviceToken = this.getCookie('serviceToken');
            if (serviceToken) {
                this.serviceToken = serviceToken;
                this.logger.debug(`Cloud auth: service token received after ${redirect} redirect(s)`);
                return;
            }
            if (response.status < 300 || response.status >= 400 || !response.headers.location) {
                this.logger.debug(`Cloud auth: service-token request ended with HTTP ${response.status} without token`);
                break;
            }
            this.logger.debug(`Cloud auth: following service-token redirect ${redirect + 1}`);
            requestUrl = new URL(response.headers.location, requestUrl).toString();
        }
        throw new Error('Xiaomi did not provide a service token');
    }

    getCookie(name) {
        return this.sessionCookies
            .split(';')
            .map(cookie => cookie.trim())
            .find(cookie => cookie.startsWith(`${name}=`))
            ?.slice(name.length + 1);
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
        return { err: 'Xiaomi Cloud authentication required; start the QR login in the adapter configuration' };
    }

    async refreshToken() {
        await this.invalidateSession('not_authenticated');
        return { err: 'Xiaomi Cloud authentication required; start the QR login in the adapter configuration' };
    }

    async invalidateSession(status = 'not_authenticated', lastError = '') {
        this.logger.debug(`Cloud auth: invalidating session (${lastError || status})`);
        this.ssecurity = null;
        this.userId = null;
        this.location = null;
        this.serviceToken = null;
        this.sessionCookies = '';
        await this.clearPersistedSession();
        await this.updateAuth(status, { loginUrl: '', expiresAt: 0, lastError });
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
                await this.invalidateSession('not_authenticated', 'Xiaomi Cloud session is no longer authorized');
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

    /**
     * @param {unknown} error External request or parsing error.
     */
    safeError(error) {
        const errorObject = error && typeof error === 'object' ? error : null;
        const response = errorObject && 'response' in errorObject ? errorObject.response : null;
        const status = response && typeof response === 'object' && 'status' in response ? response.status : null;
        if (status) {
            return `Xiaomi request failed (HTTP ${status})`;
        }
        const code = errorObject && 'code' in errorObject ? errorObject.code : null;
        if (code === 'ECONNABORTED') {
            return 'Xiaomi request timed out';
        }
        const message = error instanceof Error ? error.message : 'Xiaomi request failed';
        return String(message).replace(/https?:\/\/\S+/g, '[redacted URL]');
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
        return signedNonce(nonce, ssecurity);
    }
    generateNonce(millis) {
        return generateNonce(millis);
    }
    generateEncSignature(url, method, signedNonce, params) {
        return generateEncSignature(url, method, signedNonce, params);
    }
    generateEncryptedParams(rc4, url, method, nonce, params, ssecurity) {
        return generateEncryptedParams(rc4, url, method, nonce, params, ssecurity);
    }
}

module.exports = XiaomiCloudConnector;
