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

    it('loads and saves timers through the validated adapter backend', () => {
        assert.match(adminSource, /sendTo\(adapter \+ '\.' \+ instance, 'getTimers'/);
        assert.match(adminSource, /sendTo\(adapter \+ '\.' \+ instance, 'saveTimers'/);
        assert.match(adminSource, /rooms: timer\.room \|\| \[\]/);
        assert.match(adminSource, /room: timer\.rooms \|\| \[\]/);
        assert.match(adminSource, /typeof systemLang === 'string'/);
        assert.match(adminSource, /replace\(\/\[<>&'";\\\/\]\/g, ' '\)/);
        assert.doesNotMatch(adminSource, /getForeignStates', namespace \+ ['"]timer\.\*['"]/);
        assert.doesNotMatch(adminSource, /socket\.emit\('delObject', t\)/);
        assert.doesNotMatch(adminSource, /socket\.emit\('setObject', stateId/);
    });

    it('provides every QR login label in all supported admin languages', () => {
        const dictionary = require('../admin/words.js');
        const languages = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'zh-cn'];
        for (const key of [
            'Xiaomi cloud login',
            'Start Xiaomi QR login',
            'Cloud status',
            'QR login help',
            'Could not load timers',
            'Could not save timers',
        ]) {
            assert.deepEqual(Object.keys(dictionary[key]), languages);
        }
    });
});

describe('React admin security', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'src-admin', 'src', 'App.tsx'), 'utf8');
    const timerSource = fs.readFileSync(path.join(__dirname, '..', 'src-admin', 'src', 'TimerTab.tsx'), 'utf8');

    it('keeps discovered tokens out of select values and labels', () => {
        assert.match(appSource, /value=\{index\}/);
        assert.match(appSource, /device\.model \|\| I18n\.t\('Unknown device'\)/);
        assert.match(appSource, /device\.localip \? ` – \$\{device\.localip\}` : ''/);
        assert.doesNotMatch(appSource, /value=\{JSON\.stringify\(device\)\}/);
        assert.doesNotMatch(appSource, /device\.token\}\s*<\/MenuItem>/);
    });

    it('polls QR authentication safely and cleans up its timer', () => {
        assert.match(appSource, /setInterval\(\(\) => void this\.updateCloudAuth\(\), 3_000\)/);
        assert.match(appSource, /clearInterval\(this\.authPollTimer\)/);
        assert.match(appSource, /this\.state\.auth\.status !== 'authenticated'/);
    });

    it('uses the authenticated discovery message without legacy credentials', () => {
        assert.match(appSource, /'discovery',\s*\{ authObj: \{\}, server: this\.state\.native\.server \}/);
        assert.doesNotMatch(appSource, /authObj:\s*\{[^}]*password/);
    });

    it('loads and saves timer definitions only through the validated backend', () => {
        assert.match(appSource, /'getTimers'/);
        assert.match(appSource, /'saveTimers'/);
        assert.match(appSource, /ids\.has\(id\)/);
        assert.match(appSource, /override onSave\(isClose\?: boolean\)/);
        assert.match(timerSource, /rooms: \[\], channels: \[\]/);
        assert.doesNotMatch(timerSource, /getForeignStates|setObject|delObject/);
    });

    it('validates and sanitizes configuration before saving', () => {
        assert.match(appSource, /\[31, 32, 96\]\.includes\(token\.length\)/);
        assert.match(appSource, /delete settings\.devices/);
        assert.match(appSource, /delete settings\.MiDevice/);
        assert.match(appSource, /deviceInfo\.unsupported/);
    });

    it('provides every new React and timer label in all supported languages', () => {
        const dictionary = require('../admin/words.js');
        const languages = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'zh-cn'];
        for (const key of [
            'Save timers',
            'No timers configured',
            'Timers saved',
            'Unknown device',
            'Invalid timer definition',
        ]) {
            assert.deepEqual(Object.keys(dictionary[key]), languages);
        }
    });
});
