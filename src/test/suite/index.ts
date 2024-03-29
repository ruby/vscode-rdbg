import * as path from "path";
import * as Mocha from "mocha";
import { glob } from "glob";
import { MochaOptions } from "mocha";

export function run(): Promise<void> {
    const mochaOpts: MochaOptions = {
        ui: "tdd",
        color: true,
    };
    const testReports = process.env.LAUNCHABLE_TEST_REPORTS;
    if (testReports) {
        mochaOpts.reporter = "mocha-junit-reporter";
        mochaOpts.reporterOptions = {
            mochaFile: testReports,
        };
    }
    // Create the mocha test
    const mocha = new Mocha(mochaOpts);

    mocha.timeout("20000");

    const testsRoot = path.resolve(__dirname, "..");

    return new Promise(async (c, e) => {
        const files = await glob("**/**.test.js", { cwd: testsRoot });
        // Add files to the test suite
        files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

        try {
            // Run the mocha test
            mocha.run((failures) => {
                if (failures > 0) {
                    e(new Error(`${failures} tests failed.`));
                } else {
                    c();
                }
            });
        } catch (err) {
            console.error(err);
            e(err);
        }
    });
}
