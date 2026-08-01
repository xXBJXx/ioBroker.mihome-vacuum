const assert = require('node:assert/strict');
const LegacyCrypto = require('../lib/XiaomiCloudCrypto');
const TypedCrypto = require('../build/lib/XiaomiCloudCrypto');
const XiaomiCloudConnector = require('../lib/XiaomiCloudConnector');

describe('Xiaomi Cloud cryptography TypeScript migration', () => {
    const millis = 1_700_000_000_000;
    const nonce = 'AAECAwQFBgcBsFUV';
    const ssecurity = Buffer.alloc(16, 1).toString('base64');
    const expectedSignedNonce = 'cpjbFUb//hR2sAgYryNz/jjsqNrczR7MZlCwjyhHe8o=';
    const url = 'https://de.api.io.mi.com/app/home/getmapfileurl';
    const params = { data: '{"obj_name":"synthetic-map"}' };

    it('preserves nonce, signed nonce, and request signature fixtures', () => {
        const randomBytes = () => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
        assert.equal(LegacyCrypto.generateNonce(millis, randomBytes), nonce);
        assert.equal(TypedCrypto.generateNonce(millis, randomBytes), nonce);

        assert.equal(LegacyCrypto.signedNonce(nonce, ssecurity), expectedSignedNonce);
        assert.equal(TypedCrypto.signedNonce(nonce, ssecurity), expectedSignedNonce);
        assert.equal(
            LegacyCrypto.generateEncSignature(url, 'POST', expectedSignedNonce, params),
            'A8gwUO8rQZNJw949YdZdceeIpwQ=',
        );
        assert.equal(
            TypedCrypto.generateEncSignature(url, 'POST', expectedSignedNonce, params),
            'A8gwUO8rQZNJw949YdZdceeIpwQ=',
        );
    });

    it('preserves RC4-drop-1024 encryption and decryption bytes', () => {
        const plainText = 'synthetic-cloud-payload';
        const expectedCipherText = 'JlWLhwAPv/HfHfm7u4efpcm6/Lkk4aI=';
        const legacyCipherText = new LegacyCrypto.XiaomiRC4Cipher(expectedSignedNonce).encrypt(plainText);
        const typedCipherText = new TypedCrypto.XiaomiRC4Cipher(expectedSignedNonce).encrypt(plainText);

        assert.equal(legacyCipherText, expectedCipherText);
        assert.equal(typedCipherText, expectedCipherText);
        assert.equal(new LegacyCrypto.XiaomiRC4Cipher(expectedSignedNonce).decrypt(expectedCipherText), plainText);
        assert.equal(new TypedCrypto.XiaomiRC4Cipher(expectedSignedNonce).decrypt(expectedCipherText), plainText);
    });

    it('preserves encrypted parameter order and signatures', () => {
        const legacy = LegacyCrypto.generateEncryptedParams(
            new LegacyCrypto.XiaomiRC4Cipher(expectedSignedNonce),
            url,
            'POST',
            nonce,
            structuredClone(params),
            ssecurity,
        );
        const typed = TypedCrypto.generateEncryptedParams(
            new TypedCrypto.XiaomiRC4Cipher(expectedSignedNonce),
            url,
            'POST',
            nonce,
            structuredClone(params),
            ssecurity,
        );
        const expected = {
            data: 'Lg6KkQI1pfnRVbjt9oGC5s2z4KEi4+sgr02kiQ==',
            rc4_hash__: 'EUFfTiLB6W7+INfBkjkWVmKb0OMko35bL+ze0A==',
            signature: 'vvvCRTG/gZS2M3r0KCdNRySTyU8=',
            ssecurity,
            _nonce: nonce,
        };

        assert.deepEqual(legacy, expected);
        assert.deepEqual(typed, expected);
        assert.deepEqual(Object.keys(typed), Object.keys(legacy));
    });

    it('keeps the connector compatibility methods delegated to the extracted module', () => {
        const connector = new XiaomiCloudConnector(
            { debug() {}, info() {}, warn() {}, error() {} },
            {},
            { config: {} },
        );

        assert.equal(connector.signedNonce(nonce, ssecurity), LegacyCrypto.signedNonce(nonce, ssecurity));
        assert.equal(
            connector.generateEncSignature(url, 'POST', expectedSignedNonce, params),
            LegacyCrypto.generateEncSignature(url, 'POST', expectedSignedNonce, params),
        );
    });
});
