import * as path from "path";
import * as Mocha from "mocha";
import * as glob from "glob";
import { MochaOptions } from "mocha";

export function run(): Promise<void> {
	const mochaOpts: MochaOptions = {
		ui: "tdd",
		color: true
	}
	const testReports = process.env.LAUNCHABLE_TEST_REPORTS
	console.log('debug')
	console.log(testReports)
	if (testReports) {
		mochaOpts.reporter = 'mocha-junit-reporter';
		mochaOpts.reporterOptions = {
			mochaFile: testReports
		}
	}
	// Create the mocha test
	const mocha = new Mocha(mochaOpts);

	mocha.timeout("20000");

	const testsRoot = path.resolve(__dirname, "..");

	return new Promise((c, e) => {
		glob("**/**.test.js", { cwd: testsRoot }, (err, files) => {
			if (err) {
				return e(err);
			}

			// Add files to the test suite
			files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

			try {
				// Run the mocha test
				mocha.run(failures => {
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
	});
}
