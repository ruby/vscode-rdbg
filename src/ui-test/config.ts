import { MochaOptions } from "vscode-extension-tester";

const options: MochaOptions = {
    timeout: 180000,
};

const testReports = process.env.LAUNCHABLE_TEST_REPORTS;
if (testReports) {
    options.reporter = "mocha-junit-reporter";
    options.reporterOptions = {
        mochaFile: testReports,
    };
}

module.exports = options;
