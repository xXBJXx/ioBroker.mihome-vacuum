const path = require('path');
const fs = require('node:fs');
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

    it('runs JavaScript regression tests in CI independently from linting', () => {
        const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'test-and-release.yml'), 'utf8');

        assert.match(workflow, /^    regression-tests:/m);
        assert.match(workflow, /^              run: npm run test:js$/m);
        const regressionJob = workflow.slice(workflow.indexOf('    regression-tests:'), workflow.indexOf('    check-and-lint:'));
        assert.doesNotMatch(regressionJob, /^        needs:/m);
    });

    it('ships only the declared Materialize configuration page', () => {
        const ioPackage = require('../io-package.json');
        const adminDirectory = path.join(__dirname, '..', 'admin');

        assert.equal(ioPackage.common.adminUI.config, 'materialize');
        assert.equal(fs.existsSync(path.join(adminDirectory, 'index_m.html')), true);
        assert.equal(fs.existsSync(path.join(adminDirectory, 'index.html')), false);
    });
});
