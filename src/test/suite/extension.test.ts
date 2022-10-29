import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as myExtension from '../../extension';

const twoCrlf = '\r\n\r\n';

suite('attach', () => {
	suite('tcp: success', () => {
		let server: net.Server;
		suiteSetup(() => {
			server = net.createServer((sock) => {
				sock.on('data', (data: Buffer) => {
					const rawReq = data.toString().split(twoCrlf);
					try {
						const req = JSON.parse(rawReq[1]) as DebugProtocol.Request;
						const res: DebugProtocol.Response = {
							seq: req.seq,
							type: 'response',
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
				console.log('server bound');
			});
		});

		suiteTeardown(() => {
			server.close();
		});

		test('localhost:{port}', async () => {
			const addr = server.address() as net.AddressInfo;
			const port = addr.port;
			const c = generateAttachConfig();
			c.debugPort = `localhost:${port}`;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
			return new Promise((resolve, reject) => resolve());
		});

		test('port', async () => {
			const addr = server.address() as net.AddressInfo;
			const port = addr.port;
			const c = generateAttachConfig();
			c.debugPort = port.toString();
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
			return new Promise((resolve, reject) => resolve());
		});
	});

	suite('tcp: fail', () => {
		let server: net.Server;
		suiteSetup(() => {
			server = net.createServer((sock) => {
				sock.on('data', (data: Buffer) => {
					sock.end();
				});
			});
			server.listen(0, () => {
				console.log('server bound');
			});
		});

		suiteTeardown(() => {
			server.close();
		});

		test('return false', async () => {
			const addr = server.address() as net.AddressInfo;
			const port = addr.port;
			const c = generateAttachConfig();
			c.debugPort = `localhost:${port}`;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.strictEqual(success, false);
			return new Promise((resolve, reject) => resolve());
		});
	});

	suite('unix domain socket: success', () => {
		let server: net.Server | undefined;
		let tempDir: string | undefined;
		let sockPath: string | undefined;
		suiteSetup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-rdbg-test-'));
			sockPath = tempDir + '/' + Date.now().toString() + '.sock';
			server = net.createServer((sock) => {
				sock.on('data', (data: Buffer) => {
					const rawReq = data.toString().split(twoCrlf);
					try {
						const req = JSON.parse(rawReq[1]) as DebugProtocol.Request;
						const res: DebugProtocol.Response = {
							seq: req.seq,
							type: 'response',
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
				console.log('server bound');
			});
		});

		suiteTeardown(() => {
			if (server) server.close();
			if (tempDir) fs.rmdirSync(tempDir);
		});

		test('return true', async () => {
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

	suite('unix domain socket: fail', () => {
		let server: net.Server | undefined;
		let tempDir: string | undefined;
		let sockPath: string | undefined;
		suiteSetup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-rdbg-test-'));
			sockPath = tempDir + '/' + Date.now().toString() + '.sock';
			server = net.createServer((sock) => {
				sock.on('data', (data: Buffer) => {
					sock.end();
				});
			});
			server.listen(sockPath, () => {
				console.log('server bound');
			});
		});

		suiteTeardown(() => {
			if (server) server.close();
			if (tempDir) fs.rmdirSync(tempDir);
		});

		test('return false', async () => {
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

suite('launch', () => {
	suite('tcp: success', () => {
		const projectRoot = path.join(__dirname, '..', '..', '..');
		const testData = path.join(projectRoot, 'src', 'test', 'testdata', 'test.rb');

		let port: number;
		suiteSetup(() => {
			const server = net.createServer((sock) => {
				sock.on('data', (data: Buffer) => {
					sock.end();
				});
			});
			server.listen(0, () => {
				console.log('server bound');
			});
			const addr = server.address() as net.AddressInfo;
			port = addr.port;
			server.close();
		});

		test('localhost:{port}', async () => {
			const c = generateLaunchConfig(testData);
			c.debugPort = `localhost:${port}`;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
			return new Promise((resolve, reject) => resolve());
		});

		test('port', async () => {
			const c = generateLaunchConfig(testData);
			c.debugPort = port.toString();
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
			return new Promise((resolve, reject) => resolve());
		});
	});

	suite('unix domain socket: success', () => {
		const projectRoot = path.join(__dirname, '..', '..', '..');
		const testData = path.join(projectRoot, 'src', 'test', 'testdata', 'test.rb');

		test('config.debugPort is undefined', async () => {
			const c = generateLaunchConfig(testData);
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
			return new Promise((resolve, reject) => resolve());
		});
	});

	suite('unix domain socket: fail', () => {
		const projectRoot = path.join(__dirname, '..', '..', '..');
		const testData = path.join(projectRoot, 'src', 'test', 'testdata', 'test.rb');
		let tempDir: string;
		let sockPath: string;
		suiteSetup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-rdbg-test-'));
			sockPath = tempDir + '/' + Date.now().toString() + '.sock';
		});

		suiteTeardown(async () => {
			await waitToRemoveFile(tempDir);
			fs.rmdirSync(tempDir);
		});

		test('return false', async () => {
			const c = generateLaunchConfig(testData);
			c.debugPort = sockPath;
			const success = await vscode.debug.startDebugging(undefined, c);
			assert.ok(success);
			return new Promise((resolve, reject) => resolve());
		});
	});
});

function sleep(seconds: number) {
	return new Promise((resolve) => setTimeout(resolve, seconds));
}

async function waitToRemoveFile(tempDir: string) {
	while (true) {
		const files = fs.readdirSync(tempDir);
		if (files.length === 0) break;
		await sleep(100);
	}
}

function generateAttachConfig(): AttachConfiguration {
	return {
		type: 'rdbg',
		name: '',
		request: 'attach',
	};
}

function generateLaunchConfig(script: string): LaunchConfiguration {
	return {
		type: 'rdbg',
		name: '',
		request: 'launch',
		script,
	};
}

interface AttachConfiguration extends vscode.DebugConfiguration {
	type: 'rdbg';
	request: 'attach';
	rdbgPath?: string;
	debugPort?: string;
	cwd?: string;
	showProtocolLog?: boolean;

	autoAttach?: string;
}

interface LaunchConfiguration extends vscode.DebugConfiguration {
	type: 'rdbg';
	request: 'launch';

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
}

