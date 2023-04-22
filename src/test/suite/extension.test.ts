import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";

import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DebugProtocol } from "@vscode/debugprotocol";

const twoCrlf = "\r\n\r\n";
const randomPort = 0;

suite("attach", () => {
	suite("tcp: success", () => {
		let server: net.Server;
		setup(() => {
			server = net.createServer((sock) => {
				sock.on("data", (data: Buffer) => {
					const rawReq = data.toString().split(twoCrlf);
					try {
						const req = JSON.parse(rawReq[1]) as DebugProtocol.Request;
						const res: DebugProtocol.Response = {
							seq: req.seq,
							type: "response",
							// eslint-disable-next-line @typescript-eslint/naming-convention
							request_seq: req.seq,
							success: true,
							command: req.command,
						};
						const json = JSON.stringify(res);
						const header = `Content-Length: ${Buffer.byteLength(json)}`;
						sock.write(header + twoCrlf + json);
					} catch (error) {
						console.error(error);
						sock.end();
					}
				});
			});
			server.listen(0, () => {
				console.log("server bound");
			});
		});

		teardown(() => {
			server.close();
		});

		test("localhost:{port}", async () => {
			const addr = server.address() as net.AddressInfo;
			const port = addr.port;
			const c = generateAttachConfig();
			c.debugPort = `localhost:${port}`;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});

		test("port", async () => {
			const addr = server.address() as net.AddressInfo;
			const port = addr.port;
			const c = generateAttachConfig();
			c.debugPort = port.toString();
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});

		suite("auto attach", () => {
			const key = Math.random().toString();
			suiteSetup(() => {
				process.env.RUBY_DEBUG_AUTOATTACH = key;
			});

			suiteTeardown(() => {
				process.env.RUBY_DEBUG_AUTOATTACH = undefined;
			});

			test("success", async () => {
				const addr = server.address() as net.AddressInfo;
				const port = addr.port;
				const c = generateAttachConfig();
				c.debugPort = port.toString();
				c.autoAttach = key;
				const success = await vscode.debug.startDebugging(undefined, c);
				assert.ok(success);
			});
		});
	});

	suite("tcp: fail", () => {
		let server: net.Server;
		setup(() => {
			server = net.createServer((sock) => {
				sock.on("data", (_data: Buffer) => {
					sock.end();
				});
			});
			server.listen(0, () => {
				console.log("server bound");
			});
		});

		teardown(() => {
			server.close();
		});

		test("return false", async () => {
			const addr = server.address() as net.AddressInfo;
			const port = addr.port;
			const c = generateAttachConfig();
			c.debugPort = `localhost:${port}`;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.strictEqual(success, false);
		});
	});

	suite("unix domain socket: success", () => {
		let server: net.Server | undefined;
		let tempDir: string | undefined;
		let sockPath: string | undefined;
		setup(function () {
			if (process.platform === "win32") this.skip();

			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-rdbg-test-"));
			sockPath = tempDir + "/" + Date.now().toString() + ".sock";
			server = net.createServer((sock) => {
				sock.on("data", (data: Buffer) => {
					const rawReq = data.toString().split(twoCrlf);
					try {
						const req = JSON.parse(rawReq[1]) as DebugProtocol.Request;
						const res: DebugProtocol.Response = {
							seq: req.seq,
							type: "response",
							// eslint-disable-next-line @typescript-eslint/naming-convention
							request_seq: req.seq,
							success: true,
							command: req.command,
						};
						const json = JSON.stringify(res);
						const header = `Content-Length: ${Buffer.byteLength(json)}`;
						sock.write(header + twoCrlf + json);
					} catch (error) {
						console.error(error);
						sock.end();
					}
				});
			});
			server.listen(sockPath, () => {
				console.log("server bound");
			});
		});

		teardown(() => {
			if (server) server.close();
			if (tempDir) fs.rmdirSync(tempDir);
		});

		test("return true", async () => {
			return new Promise((resolve, reject) => {
				if (server === undefined || sockPath === undefined) return reject();
				const c = generateAttachConfig();
				c.debugPort = sockPath;
				vscode.debug.startDebugging(undefined, c).then((success) => {
					assert.ok(success);
					resolve();
				});
			});
		});
	});

	suite("unix domain socket: fail", () => {
		let server: net.Server | undefined;
		let tempDir: string | undefined;
		let sockPath: string | undefined;
		setup(function () {
			if (process.platform === "win32") this.skip();

			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-rdbg-test-"));
			sockPath = tempDir + "/" + Date.now().toString() + ".sock";
			server = net.createServer((sock) => {
				sock.on("data", (_data: Buffer) => {
					sock.end();
				});
			});
			server.listen(sockPath, () => {
				console.log("server bound");
			});
		});

		teardown(() => {
			if (server) server.close();
			if (tempDir) fs.rmdirSync(tempDir);
		});

		test("return false", async () => {
			return new Promise((resolve, reject) => {
				if (server === undefined || sockPath === undefined) return reject();
				const c = generateAttachConfig();
				c.debugPort = sockPath;
				vscode.debug.startDebugging(undefined, c).then((success) => {
					assert.strictEqual(success, false);
					resolve();
				});
			});
		});
	});
});

suite("launch", () => {
	suite("tcp: success", () => {
		const projectRoot = path.join(__dirname, "..", "..", "..");
		const testData = path.join(projectRoot, "src", "test", "testdata", "test.rb");

		test("localhost:{port}", async () => {
			const c = generateLaunchConfig(testData);
			c.debugPort = `localhost:${randomPort}`;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});

		test("port", async () => {
			const c = generateLaunchConfig(testData);
			c.debugPort = randomPort.toString();
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});

		test("env", async () => {
			const c = generateLaunchConfig(testData);
			c.env = { "SAMPLE": "sample" };
			c.debugPort = randomPort.toString();
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});

		test("v2: localhost:{port}", async () => {
			const c = generateLaunchV2Config(testData);
			c.debugPort = `localhost:${randomPort}`;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});

		test("v2: port", async () => {
			const c = generateLaunchV2Config(testData);
			c.debugPort = randomPort.toString();
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});

		test("v2: env", async () => {
			const c = generateLaunchV2Config(testData);
			c.env = { "SAMPLE": "sample" };
			c.debugPort = randomPort.toString();
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});
	});

	suite("tcp: fail", () => {
		const projectRoot = path.join(__dirname, "..", "..", "..");
		const testData = path.join(projectRoot, "src", "test", "testdata", "test.rb");

		test("noDebug is true", async () => {
			const c = generateLaunchConfig(testData);
			c.debugPort = randomPort.toString();
			c.noDebug = true;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(!success);
		});

		test("v2: noDebug is true", async () => {
			const c = generateLaunchV2Config(testData);
			c.debugPort = randomPort.toString();
			c.noDebug = true;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(!success);
		});
	});

	suite("default: success", () => {
		const projectRoot = path.join(__dirname, "..", "..", "..");
		const testData = path.join(projectRoot, "src", "test", "testdata", "test.rb");

		test("config.debugPort is undefined", async () => {
			const c = generateLaunchConfig(testData);
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});

		test("v2: config.debugPort is undefined", async () => {
			const c = generateLaunchV2Config(testData);
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});
	});

	suite("unix domain socket: fail", () => {
		const projectRoot = path.join(__dirname, "..", "..", "..");
		const testData = path.join(projectRoot, "src", "test", "testdata", "test.rb");
		let tempDir: string | undefined;
		let sockPath: string | undefined;
		setup(function () {
			if (process.platform === "win32") this.skip();

			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-rdbg-test-"));
			sockPath = tempDir + "/" + Date.now().toString() + ".sock";
		});

		teardown(() => {
			/*
				The socket file will be deleted after server process is finished in Socket#unix_server_loop,
				but sometimes it is not deleted and remain.
				Then, test is failed such as https://github.com/ruby/vscode-rdbg/actions/runs/4350570271/jobs/7601404118\#step:9:80.
				That's why we need to remove directory forcibly here.
			*/
			if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });;
		});

		test("return false", async () => {
			const c = generateLaunchConfig(testData);
			c.debugPort = sockPath;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});

		test("v2: return false", async () => {
			const c = generateLaunchV2Config(testData);
			c.debugPort = sockPath;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
		});
	});
});

function generateAttachConfig(): AttachConfiguration {
	return {
		type: "rdbg",
		name: "",
		request: "attach",
	};
}

function generateLaunchConfig(script: string): LaunchConfiguration {
	const config: LaunchConfiguration = {
		type: "rdbg",
		name: "",
		request: "launch",
		useTerminal: true,
		script,
		waitLaunchTime: 10000,
	};
	if (process.platform === "darwin" && process.env.RUBY_DEBUG_TEST_PATH) {
		config.command = process.env.RUBY_DEBUG_TEST_PATH;
	}
	return config;
}

function generateLaunchV2Config(script: string): LaunchConfiguration {
	const config: LaunchConfiguration = {
		type: "rdbg",
		name: "",
		request: "launch",
		script,
	};
	if (process.platform === "darwin" && process.env.RUBY_DEBUG_TEST_PATH) {
		config.command = process.env.RUBY_DEBUG_TEST_PATH;
	}
	if (process.platform === "win32") {
		config.waitLaunchTime = 10000;
	}
	return config;
}

interface AttachConfiguration extends vscode.DebugConfiguration {
	type: "rdbg";
	request: "attach";
	rdbgPath?: string;
	debugPort?: string;
	cwd?: string;
	showProtocolLog?: boolean;

	autoAttach?: string;
}

interface LaunchConfiguration extends vscode.DebugConfiguration {
	type: "rdbg";
	request: "launch";

	script: string;

	command?: string; // ruby
	cwd?: string;
	args?: string[];
	env?: { [key: string]: string };

	debugPort?: string;
	waitLaunchTime?: number;

	useBundler?: boolean;
	askParameters?: boolean;

	rdbgPath?: string;
	showProtocolLog?: boolean;

	useTerminal?: boolean
}
