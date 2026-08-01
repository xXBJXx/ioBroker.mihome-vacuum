const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('Materialize admin security', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index_m.html'), 'utf8');

    it('does not log or visibly render a discovered device token', () => {
        assert.doesNotMatch(adminSource, /console\.log\(["']changed\.\.\.\.devices/);
        assert.doesNotMatch(adminSource, /\s- token:\s/);
    });

    it('creates device options without HTML string concatenation', () => {
        assert.match(adminSource, /createDeviceOption/);
        assert.match(adminSource, /\.text\(label\)/);
        assert.doesNotMatch(adminSource, /#devices['"]\)\.html\(/);
    });

    it('keeps the inline admin JavaScript syntactically valid', () => {
        const inlineScripts = [...adminSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];

        assert.ok(inlineScripts.length > 0);
        for (const script of inlineScripts) {
            new vm.Script(script[1]);
        }
    });

    it('cleans up cloud authentication polling and avoids duplicate login handlers', () => {
        assert.match(adminSource, /clearInterval\(cloudAuthPollTimer\)/);
        assert.match(adminSource, /off\('click\.mihomeVacuumAuth'\)\.on\('click\.mihomeVacuumAuth'/);
        assert.match(adminSource, /on\('unload\.mihomeVacuumAuth', stopCloudAuthPolling\)/);
    });

    it('provides every QR login label in all supported admin languages', () => {
        const dictionary = require('../admin/words.js');
        const languages = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'zh-cn'];
        for (const key of ['Xiaomi cloud login', 'Start Xiaomi QR login', 'Cloud status', 'QR login help']) {
            assert.deepEqual(Object.keys(dictionary[key]), languages);
        }
    });
});
