const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();

function loadToolsWithAxios(fakeAxios) {
    return proxyquire('../lib/tools', {
        axios: { default: fakeAxios },
    });
}

describe('Shared tools', () => {
    it('preserves the dedicated Google Translate rate-limit error', async () => {
        const rateLimitError = { response: { status: 429 } };
        const fakeAxios = async () => {
            throw rateLimitError;
        };
        fakeAxios.isAxiosError = error => error === rateLimitError;
        const tools = loadToolsWithAxios(fakeAxios);

        await assert.rejects(tools.translateText('test', 'de'), /Rate-limited by Google Translate/);
    });

    it('does not classify arbitrary failures as Axios rate limits', async () => {
        const fakeAxios = async () => {
            throw new Error('synthetic translation failure');
        };
        fakeAxios.isAxiosError = () => false;
        const tools = loadToolsWithAxios(fakeAxios);

        await assert.rejects(tools.translateText('test', 'de'), /synthetic translation failure/);
    });

    it('distinguishes plain objects from arrays and null', () => {
        const fakeAxios = Object.assign(async () => ({}), { isAxiosError: () => false });
        const tools = loadToolsWithAxios(fakeAxios);

        assert.equal(tools.isObject({}), true);
        assert.equal(tools.isObject([]), false);
        assert.equal(tools.isObject(null), false);
        assert.equal(tools.isArray([]), true);
        assert.equal(tools.isArray({}), false);
    });
});
