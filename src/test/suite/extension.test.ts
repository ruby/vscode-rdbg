import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DebugProtocol } from '@vscode/debugprotocol';

const twoCrlf = '\r\n\r\n';

suite('attach in tcp: success', () => {
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
		const c: vscode.DebugConfiguration = {
			type: "rdbg",
			name: "Attach with rdbg",
			request: "attach",
			debugPort: `localhost:${port}`,
			internalConsoleOptions: false,
		};
		const success = await vscode.debug.startDebugging(undefined, c);
		return new Promise((resolve, reject) => {
			assert.ok(success);
			resolve();
		});
	});

	test('port', async () => {
		const addr = server.address() as net.AddressInfo;
		const port = addr.port;
		const c: vscode.DebugConfiguration = {
			type: "rdbg",
			name: "Attach with rdbg",
			request: "attach",
			debugPort: port.toString(),
			internalConsoleOptions: false,
		};
		const success = await vscode.debug.startDebugging(undefined, c);
		return new Promise((resolve, reject) => {
			assert.ok(success);
			resolve();
		});
	});
});

suite('attach in tcp: fail', () => {
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
		const c: vscode.DebugConfiguration = {
			type: "rdbg",
			name: "Attach with rdbg",
			request: "attach",
			debugPort: `localhost:${port}`,
			internalConsoleOptions: false,
		};
		const success = await vscode.debug.startDebugging(undefined, c);
		return new Promise((resolve, reject) => {
			assert.strictEqual(success, false);
			resolve();
		});
	});
});

suite('attach in unix domain socket: success', () => {
	let server: net.Server | undefined;
	let tempDir: string | undefined;
	let sockPath: string | undefined;
	suiteSetup(() => {
		try {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-rdbg-test-'));
		} catch (error) {
			console.error(error);
		}
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
			const c: vscode.DebugConfiguration = {
				type: "rdbg",
				name: "Attach with rdbg",
				request: "attach",
				debugPort: sockPath,
				internalConsoleOptions: false,
			};
			vscode.debug.startDebugging(undefined, c).then((success) => {
				assert.ok(success);
				resolve();
			});
		});
	});
});

suite('attach in unix domain socket: fail', () => {
	let server: net.Server | undefined;
	let tempDir: string | undefined;
	let sockPath: string | undefined;
	suiteSetup(() => {
		try {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-rdbg-test-'));
		} catch (error) {
			console.error(error);
		}
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
			const c: vscode.DebugConfiguration = {
				type: "rdbg",
				name: "Attach with rdbg",
				request: "attach",
				debugPort: sockPath,
				internalConsoleOptions: false,
			};
			vscode.debug.startDebugging(undefined, c).then((success) => {
				assert.strictEqual(success, false);
				resolve();
			});
		});
	});
});
