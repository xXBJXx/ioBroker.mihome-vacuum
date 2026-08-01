const crypto = require('crypto');

function signedNonce(nonce, ssecurity) {
    return crypto
        .createHash('sha256')
        .update(Buffer.concat([Buffer.from(ssecurity, 'base64'), Buffer.from(nonce, 'base64')]))
        .digest('base64');
}

function generateNonce(millis, randomBytes = crypto.randomBytes) {
    const time = Buffer.alloc(4);
    time.writeUInt32BE(Math.floor(millis / 60000), 0);
    return Buffer.concat([randomBytes(8), time]).toString('base64');
}

function generateEncSignature(url, method, signedNonceValue, params) {
    return crypto
        .createHash('sha1')
        .update(
            [
                method,
                `/${url.split('/app/')[1]}`,
                ...Object.entries(params).map(([key, value]) => `${key}=${value}`),
                signedNonceValue,
            ].join('&'),
            'utf8',
        )
        .digest('base64');
}

function generateEncryptedParams(rc4, url, method, nonce, params, ssecurity) {
    params.rc4_hash__ = generateEncSignature(url, method, rc4.passwordB64, params);
    for (const [key, value] of Object.entries(params)) {
        params[key] = rc4.encrypt(value);
    }
    params.signature = generateEncSignature(url, method, rc4.passwordB64, params);
    params.ssecurity = ssecurity;
    params._nonce = nonce;
    return params;
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

module.exports = {
    signedNonce,
    generateNonce,
    generateEncSignature,
    generateEncryptedParams,
    XiaomiRC4Cipher,
};
