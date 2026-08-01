const path = require('path');
const assert = require('node:assert/strict');
const { tests } = require('@iobroker/testing');

// Validate the package files
tests.packageFiles(path.join(__dirname, '..'));

describe('Runtime dependencies', () => {
    it('declares axios as a production dependency', () => {
        const packageJson = require('../package.json');

        assert.equal(packageJson.dependencies.axios, '^1.11.0');
        assert.equal(Object.prototype.hasOwnProperty.call(packageJson.devDependencies, 'axios'), false);
    });

    it('excludes source-level tests from the runtime package', () => {
        const packageJson = require('../package.json');

        assert.equal(packageJson.files.includes('!lib/**/*.test.js'), true);
    });
});
