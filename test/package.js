const path = require('path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { tests } = require('@iobroker/testing');

// Validate the package files
tests.packageFiles(path.join(__dirname, '..'));

describe('Runtime dependencies', () => {
    it('declares axios as a production dependency', () => {
        const packageJson = require('../package.json');

        assert.equal(packageJson.dependencies.axios, '^1.19.0');
        assert.equal(Object.prototype.hasOwnProperty.call(packageJson.devDependencies, 'axios'), false);
        assert.equal(packageJson.dependencies.qs, '6.15.3');
    });

    it('keeps the approved ioBroker and release toolchain on the current baseline', () => {
        const packageJson = require('../package.json');

        assert.equal(packageJson.dependencies['@iobroker/adapter-core'], '^3.4.3');
        assert.equal(packageJson.devDependencies['@iobroker/testing'], '^5.3.0');
        assert.equal(packageJson.devDependencies['@iobroker/eslint-config'], '^2.3.4');
        assert.equal(packageJson.devDependencies['@alcalzone/release-script'], '^5.2.1');
        assert.equal(packageJson.devDependencies['@alcalzone/release-script-plugin-iobroker'], '^5.2.0');
        assert.equal(packageJson.devDependencies['@alcalzone/release-script-plugin-license'], '^5.2.2');
        assert.equal(packageJson.devDependencies['@alcalzone/release-script-plugin-manual-review'], '^5.2.0');
    });

    it('declares the documented Node.js, js-controller, and Admin minimum versions', () => {
        const packageJson = require('../package.json');
        const ioPackage = require('../io-package.json');

        assert.equal(packageJson.engines.node, '>=24');
        assert.equal(ioPackage.common.dependencies[0]['js-controller'], '>=7.2.2');
        assert.equal(ioPackage.common.globalDependencies[0].admin, '>=7.9.13');
    });

    it('uses defaults matching every declared object value type', () => {
        const objectDefinitions = require('../lib/objects');
        const mismatches = [];
        const visit = (value, path = 'objects') => {
            if (!value || typeof value !== 'object') {
                return;
            }
            if (value.common && value.common.type && Object.prototype.hasOwnProperty.call(value.common, 'def')) {
                if (typeof value.common.def !== value.common.type) {
                    mismatches.push(`${path}: ${value.common.type} != ${typeof value.common.def}`);
                }
            }
            for (const [key, child] of Object.entries(value)) {
                visit(child, `${path}.${key}`);
            }
        };

        visit(objectDefinitions);

        assert.deepEqual(mismatches, []);
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

    it('runs every CI job on the supported Node.js baseline', () => {
        const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'test-and-release.yml'), 'utf8');

        assert.match(workflow, /node-version: 24\.x/);
        assert.match(workflow, /node-version: \[24\.x\]/);
        assert.doesNotMatch(workflow, /node-version: (?:18|20|22)\.x/);
        assert.doesNotMatch(workflow, /node-version: \[[^\]]*(?:18|20|22)\.x/);
        assert.equal([...workflow.matchAll(/actions\/checkout@v6/g)].length, 4);
        assert.equal([...workflow.matchAll(/actions\/setup-node@v6/g)].length, 4);
        assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v[1-5]/);
    });

    it('ships only the declared Materialize configuration page', () => {
        const ioPackage = require('../io-package.json');
        const adminDirectory = path.join(__dirname, '..', 'admin');

        assert.equal(ioPackage.common.adminUI.config, 'materialize');
        assert.equal(fs.existsSync(path.join(adminDirectory, 'index_m.html')), true);
        assert.equal(fs.existsSync(path.join(adminDirectory, 'index.html')), false);
    });
});
