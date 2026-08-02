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

    it('builds the TypeScript backend candidate without switching the runtime entry', () => {
        const packageJson = require('../package.json');
        const buildConfig = require('../tsconfig.build.json');

        assert.equal(packageJson.main, 'main.js');
        assert.equal(packageJson.scripts['build:backend'], 'tsc -p tsconfig.build.json');
        assert.match(packageJson.scripts['test:js'], /^npm run build:backend && mocha /);
        assert.equal(buildConfig.compilerOptions.rootDir, 'src');
        assert.equal(buildConfig.compilerOptions.outDir, 'build');
        assert.equal(buildConfig.compilerOptions.noEmit, false);
        assert.equal(packageJson.files.some(entry => entry === 'build/' || entry === 'src/'), false);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'tools.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'stockCommands.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'rrMapHeader.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'RRMapParser.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'timerManager.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'roomManager.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'miio.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'maphelper.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'XiaomiCloudCrypto.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'XiaomiCloudSession.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'XiaomiCloudProtocol.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'XiaomiCloudConnector.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'viomi.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'dreame.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'vacuumProtocol.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'featureManager.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'cleaningHistory.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'vacuumStatus.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'vacuumCommandPayloads.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'multiMapProtocol.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'consumableProtocol.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'mapStateProtocol.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'networkInfoProtocol.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'miio.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'rrMap.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'timer.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'room.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'mapHelper.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'xiaomiCloud.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'xiaomiCloudConnector.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'viomi.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'dreame.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'featureManager.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'cleaningHistory.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'vacuumStatus.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'vacuumCommandPayloads.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'multiMapProtocol.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'consumableProtocol.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'mapStateProtocol.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'types', 'networkInfoProtocol.ts')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'featureManager.js')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'cleaningHistory.js')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'vacuumStatus.js')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'vacuumCommandPayloads.js')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'multiMapProtocol.js')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'consumableProtocol.js')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'mapStateProtocol.js')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'networkInfoProtocol.js')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'XiaomiCloudCrypto.js')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'XiaomiCloudSession.js')), true);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'XiaomiCloudProtocol.js')), true);
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
        assert.equal([...workflow.matchAll(/actions\/checkout@v6/g)].length, 3);
        assert.equal([...workflow.matchAll(/actions\/setup-node@v6/g)].length, 3);
        assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v[1-5]/);
        assert.match(workflow, /- name: Type-check source code\s+run: npm run check/);
    });

    it('uses the official tokenless ioBroker release workflow', () => {
        const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'test-and-release.yml'), 'utf8');
        const deployJob = workflow.slice(workflow.indexOf('    deploy:'));

        assert.match(deployJob, /needs: \[regression-tests, check-and-lint, adapter-tests\]/);
        assert.match(deployJob, /contents: write/);
        assert.match(deployJob, /id-token: write/);
        assert.match(deployJob, /uses: ioBroker\/testing-action-deploy@v1/);
        assert.match(deployJob, /node-version: "24\.x"/);
        assert.match(deployJob, /package-cache: "false"/);
        assert.match(
            deployJob,
            /github\.repository == 'iobroker-community-adapters\/ioBroker\.mihome-vacuum'/,
        );
        assert.doesNotMatch(deployJob, /NPM_TOKEN|npm-token|::set-output|npm install|actions\/create-release/);
    });

    it('uses tokenless Dependabot auto-merge for bounded update classes', () => {
        const workflow = fs.readFileSync(
            path.join(__dirname, '..', '.github', 'workflows', 'dependabot-auto-merge.yml'),
            'utf8',
        );

        assert.match(workflow, /github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'/);
        assert.match(workflow, /uses: dependabot\/fetch-metadata@v3/);
        assert.match(workflow, /gh pr merge --auto --squash/);
        assert.match(workflow, /direct:production/);
        assert.match(workflow, /direct:development/);
        assert.match(workflow, /version-update:semver-patch/);
        assert.match(workflow, /version-update:semver-minor/);
        assert.doesNotMatch(workflow, /version-update:semver-major|AUTO_MERGE_TOKEN|ahmadnassri|actions\/checkout/);
        assert.equal(fs.existsSync(path.join(__dirname, '..', '.github', 'auto-merge.yml')), false);
    });

    it('ships only the declared Materialize configuration page', () => {
        const ioPackage = require('../io-package.json');
        const adminDirectory = path.join(__dirname, '..', 'admin');

        assert.equal(ioPackage.common.adminUI.config, 'materialize');
        assert.equal(fs.existsSync(path.join(adminDirectory, 'index_m.html')), true);
        assert.equal(fs.existsSync(path.join(adminDirectory, 'index.html')), false);
    });
});
