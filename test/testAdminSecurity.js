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
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src-admin', 'src', 'main.tsx'), 'utf8');
    const timerSource = fs.readFileSync(path.join(__dirname, '..', 'src-admin', 'src', 'TimerTab.tsx'), 'utf8');
    const ioPackage = require('../io-package.json');

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
        assert.match(appSource, /waiting && this\.state\.auth\.loginUrl/);
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
        assert.doesNotMatch(appSource, /return super\.onPrepareSave\(settings\)/);
    });

    it('uses the official asynchronous ioBroker encryption contract for protected configuration', () => {
        assert.deepEqual(ioPackage.encryptedNative, ['password', 'token', 'cloudSession']);
        assert.deepEqual(ioPackage.protectedNative, ['password', 'token', 'cloudSession']);
        assert.match(appSource, /officialEncryptionPrefix = '\$\/aes-192-cbc:'/);
        assert.match(appSource, /override async getSystemConfig\(\)/);
        assert.match(appSource, /globalThis\.crypto\.subtle\.encrypt/);
        assert.match(appSource, /globalThis\.crypto\.subtle\.decrypt/);
        assert.match(appSource, /globalThis\.crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
        assert.match(appSource, /return this\.socket\.encrypt\(value\)/);
        assert.match(appSource, /return this\.socket\.decrypt\(value\)/);
        assert.match(appSource, /this\.encryptProtectedValue\(token\)/);
        assert.match(appSource, /this\.encryptProtectedValue\(password\)/);
        assert.match(appSource, /encryptedToken\.startsWith\(officialEncryptionPrefix\)/);
        assert.match(appSource, /encryptedPassword\.startsWith\(officialEncryptionPrefix\)/);
        assert.match(appSource, /settings\.token = this\.encryptedSecretsToSave\.token/);
        assert.doesNotMatch(appSource, /encryptedFields:\s*\['password', 'token'\]/);
        assert.doesNotMatch(mainSource, /encryptedFields=/);
    });

    it('recovers plain and legacy XOR tokens for migration to official encryption', () => {
        assert.match(appSource, /override onPrepareLoad\(settings:/);
        assert.match(appSource, /tokenPattern\.test\(normalizedValue\)/);
        assert.match(appSource, /const legacyValue = this\.decrypt\(storedValue\)/);
        assert.match(appSource, /this\.recoveredLegacySecret = true/);
        assert.match(appSource, /this\.setState\(\{ changed: true \}\)/);
    });

    it('keeps the token masked by default and exposes an accessible visibility toggle', () => {
        assert.match(appSource, /tokenVisible: false/);
        assert.match(appSource, /type=\{this\.state\.tokenVisible \? 'text' : 'password'\}/);
        assert.match(appSource, /this\.state\.tokenVisible \? 'Hide token' : 'Show token'/);
        assert.match(appSource, /<VisibilityOffRounded \/>/);
        assert.match(appSource, /<VisibilityRounded \/>/);
    });

    it('describes the browser flow as a login link instead of a QR code', () => {
        assert.match(appSource, /Create Xiaomi login link/);
        assert.match(appSource, /Open Xiaomi login link/);
        assert.match(appSource, /Xiaomi login link help/);
        assert.match(appSource, /waiting_for_scan: 'Waiting for login'/);
        assert.match(appSource, /I18n\.t\(authStatusLabels\[this\.state\.auth\.status\]\)/);
        assert.doesNotMatch(appSource, /Start Xiaomi QR login|QR login help/);
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
            'Xiaomi cloud authentication',
            'Create Xiaomi login link',
            'Open Xiaomi login link',
            'Could not create Xiaomi login link',
            'Xiaomi login link help',
            'Not authenticated',
            'Waiting for login',
            'Waiting for confirmation',
            'Authenticated',
            'Login link expired',
            'Authentication error',
            'Could not decrypt protected configuration',
            'Could not encrypt protected configuration',
            'Hide token',
            'Show token',
        ]) {
            assert.deepEqual(Object.keys(dictionary[key]), languages);
        }
    });
});
