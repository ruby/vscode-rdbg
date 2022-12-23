import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	CancellationToken,
	DebugAdapterDescriptor,
	DebugAdapterDescriptorFactory,
	DebugAdapterExecutable,
	DebugAdapterInlineImplementation,
	DebugAdapterNamedPipeServer,
	DebugConfiguration,
	DebugSession,
	ProviderResult,
	WorkspaceFolder,
	ThemeIcon
} from 'vscode';

import { DebugProtocol } from '@vscode/debugprotocol';

let outputChannel: vscode.OutputChannel;
let outputTerminals = new Map<string, vscode.Terminal>();
let last_exec_command: string | undefined;
let last_program: string | undefined;

const terminalName: string = 'Ruby Debug Terminal';

function workspace_folder(): string | undefined {
	if (vscode.workspace.workspaceFolders) {
		for (const ws of vscode.workspace.workspaceFolders) {
			return ws.uri.fsPath;
		}
	}
}

function custom_path(working_directory: string): string {
	if (path.isAbsolute(working_directory)) {
		return working_directory;
	} else {
		const wspath = workspace_folder();

		if (wspath) {
			return path.join(wspath, working_directory);
		} else {
			return working_directory;
		}
	}
}

function pp(obj: any) {
	outputChannel.appendLine(JSON.stringify(obj));
}

function export_breakpoints(context: vscode.ExtensionContext) {
	if (vscode.workspace.getConfiguration("rdbg").get("saveBreakpoints")) {
		let wspath = workspace_folder();

		if (wspath) {
			var bp_lines = "";
			for (const bp of vscode.debug.breakpoints) {
				if (bp instanceof vscode.SourceBreakpoint && bp.enabled) {
					// outputChannel.appendLine(JSON.stringify(bp));
					const start_line = bp.location.range.start.line + 1;
					const path = bp.location.uri.path;
					bp_lines = bp_lines + "break " + path + ":" + start_line + "\n";
				}
			}
			const bp_path = path.join(wspath, ".rdbgrc.breakpoints");
			fs.writeFile(bp_path, bp_lines, e => { });
			outputChannel.appendLine("Written: " + bp_path);
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('rdbg');

	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('rdbg', new RdbgInitialConfigurationProvider()));
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('rdbg', new RdbgAdapterDescriptorFactory()));
	context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('rdbg', new RdbgDebugAdapterTrackerFactory()));

	//
	context.subscriptions.push(vscode.debug.onDidChangeBreakpoints(e => {
		export_breakpoints(context);
	}));

	context.subscriptions.push(vscode.debug.onDidStartDebugSession(async session => {
		const config = session.configuration;
		if (config.request !== 'launch' || config.useTerminal || config.noDebug) return;

		const args: DebugProtocol.EvaluateArguments = {
			expression: ',eval $stdout.sync=true',
			context: 'repl'
		};
		try {
			await session.customRequest('evaluate', args);
		} catch (err) {
			// We need to ignore the error because this request will be failed if the version of rdbg is older than 1.7. The `,command` API is introduced from version 1.7.
			pp(err);
		}
	}));

	const folders = vscode.workspace.workspaceFolders;

	if (folders != undefined && folders.length > 0) {
		const auto_attach_config_p = (c: AttachConfiguration): boolean => {
			if (c.type == "rdbg" && c.request == "attach" && c.autoAttach) {
				if (c.autoAttach == process.env.RUBY_DEBUG_AUTOATTACH) {
					return true;
				}

				vscode.window.showErrorMessage(".vscode/rdbg_autoattach.json contains unexpected contents. Please check integrity.");
			}
			return false;
		};

		const json_path = path.join(folders[0].uri.fsPath, ".vscode/rdbg_autoattach.json");
		if (fs.existsSync(json_path)) {
			const c: AttachConfiguration = JSON.parse(fs.readFileSync(json_path, 'utf8'));

			if (auto_attach_config_p(c)) {
				fs.unlinkSync(json_path);
				vscode.debug.startDebugging(folders[0], c);
				return;
			}
		}
	}
}

export function deactivate() {
}

class RdbgDebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(session: DebugSession): ProviderResult<vscode.DebugAdapterTracker> {
		const tracker: vscode.DebugAdapterTracker = {
			onWillStartSession(): void {
				outputChannel.appendLine("[Start session]\n" + JSON.stringify(session));
			},
			onWillStopSession(): void {
				let outputTerminal = outputTerminals.get(session.id);
				if (outputTerminal) {
					outputTerminal.show();
					outputTerminals.delete(session.id);
				}
			},
			onError(e) {
				outputChannel.appendLine("[Error on session]\n" + e.name + ": " + e.message + "\ne: " + JSON.stringify(e));
			}
		};
		if (session.configuration.showProtocolLog) {
			tracker.onDidSendMessage = (message: any): void => {
				outputChannel.appendLine("[DA->VSCode] " + JSON.stringify(message));
			};
			tracker.onWillReceiveMessage = (message: any): void => {
				outputChannel.appendLine("[VSCode->DA] " + JSON.stringify(message));
			};
		}
		return tracker;
	}
}

class RdbgInitialConfigurationProvider implements vscode.DebugConfigurationProvider {
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		if (config.script || config.request == 'attach') {
			return config;
		}

		if (Object.keys(config).length > 0 && !config.script)
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return null;
			});

		// launch without configuration
		if (vscode.window.activeTextEditor?.document.languageId != 'ruby')
			return vscode.window.showInformationMessage("Select a ruby file to debug").then(_ => {
				return null;
			});

		return {
			type: 'rdbg',
			name: 'Launch',
			request: 'launch',
			script: '${file}',
			askParameters: true,
		};
	};

	provideDebugConfigurations(folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
		return [
			{
				type: 'rdbg',
				name: 'Debug current file with rdbg',
				request: 'launch',
				script: '${file}',
				args: [],
				askParameters: true,
			},
			{
				type: 'rdbg',
				name: 'Attach with rdbg',
				request: 'attach',
			}
		];
	};
}

class StopDebugAdapter implements vscode.DebugAdapter {
	private sendMessage = new vscode.EventEmitter<any>();
	readonly onDidSendMessage: vscode.Event<any> = this.sendMessage.event;

	handleMessage(message: any): void {
		const ev = {
			type: 'event',
			seq: 1,
			event: 'terminated',
		};
		this.sendMessage.fire(ev);
	}

	dispose() {
	}
}

const findRDBGTerminal = (): vscode.Terminal | undefined => {
	let terminal: vscode.Terminal | undefined;
	let currentTerminals: vscode.Terminal[] = Array.from(outputTerminals.values());
	for (const t of vscode.window.terminals) {
		if (t.name === terminalName && !t.exitStatus && !currentTerminals.includes(t)) {
			terminal = t;
			break;
		}
	}
	return terminal;
};

class RdbgAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): Promise<DebugAdapterDescriptor> {
		// session.configuration.internalConsoleOptions = "neverOpen"; // TODO: doesn't affect...
		const c = session.configuration;

		if (c.request == 'attach') {
			return this.attach(session);
		}
		else {
			// launch
			if (c.useTerminal || c.noDebug) {
				return this.launch_on_terminal(session);
			}
			else {
				return this.launch_on_console(session);
			}
		}
	}

	show_error(msg: string): void {
		outputChannel.appendLine("Error: " + msg);
		outputChannel.appendLine("Make sure to install rdbg command (`gem install debug`).\n" +
			"If you are using bundler, write `gem 'debug'` in your Gemfile.");
		outputChannel.show();
	}

	support_login(shell: string | undefined) {
		if (shell && (shell.endsWith("bash") || shell.endsWith("zsh") || shell.endsWith("fish"))) {
			return true;
		}
		else {
			return false;
		}
	}

	make_shell_command(cmd: string) {
		const shell = process.env.SHELL;
		if (this.support_login(shell)) {
			return shell + " -l -c '" + cmd + "'";
		}
		else {
			return cmd;
		}
	}

	async get_sock_list(config: AttachConfiguration): Promise<string[]> {
		const rdbg = config.rdbgPath || "rdbg";
		const cmd = this.make_shell_command(rdbg + ' --util=list-socks');
		return new Promise((resolve, reject) => {
			child_process.exec(cmd, {
				cwd: config.cwd ? custom_path(config.cwd) : workspace_folder(),
				env: { ...process.env, ...config.env }
			}, (err, stdout, stderr) => {
				if (err || stderr) {
					reject(err ?? stderr);
				} else {
					let socks: Array<string> = [];
					if (stdout.length > 0) {
						for (const line of stdout.split("\n")) {
							if (line.length > 0) {
								socks.push(line);
							}
						}
					}
					resolve(socks);
				}
			});
		});
	}

	parse_port(port: string): [string | undefined, number | undefined, string | undefined] {
		var m;

		if (port.match(/^\d+$/)) {
			return ["localhost", parseInt(port), undefined];
		}
		else if ((m = port.match(/^(.+):(\d+)$/))) {
			return [m[1], parseInt(m[2]), undefined];
		}
		else {
			return [undefined, undefined, port];
		}
	}

	async attach(session: DebugSession): Promise<DebugAdapterDescriptor> {
		const config = session.configuration as AttachConfiguration;
		let port: number | undefined;
		let host: string | undefined;
		let sock_path: string | undefined;

		if (config.noDebug) {
			vscode.window.showErrorMessage("Can not attach \"Without debugging\".");
			return new DebugAdapterInlineImplementation(new StopDebugAdapter);
		}

		if (config.debugPort) {
			[host, port, sock_path] = this.parse_port(config.debugPort);
		}
		else {
			const list = await this.get_sock_list(config);
			outputChannel.appendLine(JSON.stringify(list));

			switch (list.length) {
				case 0:
					vscode.window.showErrorMessage("Can not find attachable Ruby process.");
					return new DebugAdapterInlineImplementation(new StopDebugAdapter);
				case 1:
					sock_path = list[0];
					break;
				default:
					const sock = await vscode.window.showQuickPick(list);
					if (sock) {
						sock_path = sock;
					}
					else {
						return new DebugAdapterInlineImplementation(new StopDebugAdapter);
					}
			}
		}

		if (sock_path) {
			return new DebugAdapterNamedPipeServer(sock_path);
		}
		else if (port) {
			return new vscode.DebugAdapterServer(port, host);
		}
		else {
			vscode.window.showErrorMessage("Unrechable.");
			return new DebugAdapterInlineImplementation(new StopDebugAdapter);
		}
	}

	async get_sock_path(config: LaunchConfiguration): Promise<string | undefined> {
		return new Promise((resolve) => {
			const rdbg = config.rdbgPath || "rdbg";
			const command = this.make_shell_command(rdbg + " --util=gen-sockpath");
			const p = child_process.exec(command, {
				cwd: config.cwd ? custom_path(config.cwd) : workspace_folder(),
				env: { ...process.env, ...config.env }
			});
			let path: string;

			p.on('error', e => {
				this.show_error(e.message);
				resolve(undefined);
			});
			p.on('exit', (code) => {
				if (code != 0) {
					this.show_error("exit code is " + code);
					resolve(undefined);
				}
				else {
					resolve(path);
				}
			});
			p.stderr?.on('data', err => {
				outputChannel.appendLine(err);
			});
			p.stdout?.on('data', out => {
				path = out.trim();
			});
		});
	}

	async get_tcp_port_file(config: LaunchConfiguration): Promise<string | undefined> {
		return new Promise((resolve) => {
			const rdbg = config.rdbgPath || "rdbg";
			const command = this.make_shell_command(rdbg + " --util=gen-portpath");
			const p = child_process.exec(command, {
				cwd: config.cwd ? custom_path(config.cwd) : workspace_folder(),
				env: { ...process.env, ...config.env }
			});
			let path: string;

			p.on('error', e => {
				resolve(undefined);
			});
			p.on('exit', (code) => {
				resolve(path);
			});
			p.stderr?.on('data', err => {
				outputChannel.appendLine(err);
			});
			p.stdout?.on('data', out => {
				path = out.trim();
			});
		});
	}

	async get_version(config: LaunchConfiguration): Promise<string | null> {
		return new Promise((resolve) => {
			const rdbg = config.rdbgPath || "rdbg";
			const command = this.make_shell_command(rdbg + " --version");
			const p = child_process.exec(command, {
				cwd: config.cwd ? custom_path(config.cwd) : workspace_folder(),
				env: { ...process.env, ...config.env }
			});
			let version: string;

			p.on('error', e => {
				this.show_error(e.message);
				resolve(null);
			});
			p.on('exit', (code) => {
				if (code != 0) {
					this.show_error(command + ": exit code is " + code);
					resolve(null);
				}
				else {
					resolve(version);
				}
			});
			p.stderr?.on('data', err => {
				outputChannel.appendLine(err);
			});
			p.stdout?.on('data', out => {
				version = out.trim();
			});
		});

	}

	vernum(version: string): number {
		const vers = /rdbg (\d+)\.(\d+)\.(\d+)/.exec(version);
		if (vers) {
			return Number(vers[1]) * 1000 * 1000 + Number(vers[2]) * 1000 + Number(vers[3]);
		}
		else {
			return 0;
		}
	}

	env_prefix(env?: { [key: string]: string }): string {
		if (env) {
			let prefix = "";
			if (process.platform === 'win32') {
				for (const key in env) {
					prefix += '$Env:' + key + "='" + env[key] + "'; ";
				}
			} else {
				for (const key in env) {
					prefix += key + "='" + env[key] + "' ";
				}
			}
			return prefix;
		}
		else {
			return "";
		}
	}

	async sleep_ms(wait_ms: number) {
		await new Promise((resolve, reject) => {
			setTimeout(() => {
				resolve(0);
			}, wait_ms); // ms
		});
	}

	async wait_file(path: string, wait_ms: number | undefined): Promise<boolean> {
		let iterations: number = 50;
		if (wait_ms) {
			iterations = wait_ms / 100;
		}

		// check sock-path
		const start_time = Date.now();
		let i = 0;
		while (!fs.existsSync(path)) {
			i++;
			if (i > iterations) {
				vscode.window.showErrorMessage("Couldn't start debug session (wait for " + (Date.now() - start_time) + " ms). Please install debug.gem.");
				return false;
			}
			await this.sleep_ms(100);
		}
		return true;
	}

	async launch_on_terminal(session: DebugSession): Promise<DebugAdapterDescriptor> {
		const config = session.configuration as LaunchConfiguration;
		const rdbg = config.rdbgPath || "rdbg";

		// outputChannel.appendLine(JSON.stringify(session));

		// setup debugPort
		let sock_path: string | undefined;
		let tcp_host: string | undefined;
		let tcp_port: number | undefined;
		let tcp_port_file: string | undefined;

		if (config.debugPort) {
			[tcp_host, tcp_port, sock_path] = this.parse_port(config.debugPort);

			if (tcp_port != undefined) {
				tcp_port_file = await this.get_tcp_port_file(config);
			}
		}
		else {
			sock_path = await this.get_sock_path(config);
			if (!sock_path) {
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
			if (fs.existsSync(sock_path)) {
				vscode.window.showErrorMessage("already exists: " + sock_path);
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
			outputChannel.appendLine("sock-path: <" + sock_path + ">");
		}

		// setup terminal
		let outputTerminal = findRDBGTerminal();

		if (!outputTerminal) {
			const shell = process.env.SHELL;
			const shell_args = this.support_login(shell) ? ['-l'] : undefined;

			outputTerminal = vscode.window.createTerminal({
				name: terminalName,
				shellPath: shell,
				shellArgs: shell_args,
				message: `Created by vscode-rdbg at ${new Date()}`,
				iconPath: new ThemeIcon("ruby")
			});
		}
		outputTerminals.set(session.id, outputTerminal);

		let exec_command = '';
		try {
			exec_command = await this.getExecCommands(config);
		} catch (error) {
			if (error instanceof InvalidExecCommandError) {
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
			throw error;
		}

		let cmdline = this.env_prefix(config.env);

		if (config.noDebug) {
			cmdline += exec_command;
		} else {
			let rdbg_args: string[];
			if (tcp_host !== undefined && tcp_port !== undefined) {
				rdbg_args = this.getTCPRdbgArgs(exec_command, tcp_host, tcp_port, tcp_port_file);
			} else {
				rdbg_args = this.getUnixRdbgArgs(exec_command, sock_path);
			}
			cmdline += rdbg + ' ' + rdbg_args.join(' ');
		}

		if (outputTerminal) {
			outputTerminal.show(false);

			if (config.cwd) {
				// Ensure we are in the requested working directory
				const cd_command = "cd " + custom_path(config.cwd);
				outputTerminal.sendText(cd_command);
			}

			outputTerminal.sendText(cmdline);
		}

		if (config.noDebug) {
			return new DebugAdapterInlineImplementation(new StopDebugAdapter);
		}

		// use NamedPipe
		if (sock_path) {
			if (await this.wait_file(sock_path, config.waitLaunchTime)) {
				return new DebugAdapterNamedPipeServer(sock_path);
			}
			else {
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
		}
		else if (tcp_port != undefined) {
			if (tcp_port_file) {
				if (await this.wait_file(tcp_port_file, config.waitLaunchTime)) {
					const port_str = fs.readFileSync(tcp_port_file);
					tcp_port = parseInt(port_str.toString());
				}
				else {
					return new DebugAdapterInlineImplementation(new StopDebugAdapter);
				}
			}
			else {
				const wait_ms = config.waitLaunchTime ? config.waitLaunchTime : 5000 /* 5 sec */;
				await this.sleep_ms(wait_ms);
			}
			return new vscode.DebugAdapterServer(tcp_port, tcp_host);
		}

		// failed
		return new DebugAdapterInlineImplementation(new StopDebugAdapter);
	}

	async getExecCommands(config: LaunchConfiguration) {
		const useBundlerFlag = (config.useBundler !== undefined) ? config.useBundler : vscode.workspace.getConfiguration("rdbg").get("useBundler");
		const useBundler = useBundlerFlag && fs.existsSync(workspace_folder() + '/Gemfile');
		const ruby_command = config.command ? config.command : (useBundler ? 'bundle exec ruby' : 'ruby');
		let exec_args = config.script + " " + (config.args ? config.args.join(' ') : '');
		let exec_command: string | undefined = ruby_command + ' ' + exec_args;

		if (config.askParameters) {
			if (last_exec_command && last_program === config.script) {
				exec_command = last_exec_command;
			}

			exec_command = await vscode.window.showInputBox({
				"title": "Debug command line",
				"value": exec_command
			});
		}
		if (exec_command === undefined || exec_command.length <= 0) {
			throw new InvalidExecCommandError();
		}
		// Save the history of command and script to use next time in `config.askParameters`.
		last_exec_command = exec_command;
		last_program = config.script;

		return exec_command;
	}

	getTCPRdbgArgs(execCommand: string, host: string, port: number, port_path?: string) {
		const rdbg_args: string[] = [];
		rdbg_args.push('--command', '--open', '--stop-at-load');
		rdbg_args.push("--host=" + host);
		let portArg = port.toString();
		if (port_path) {
			portArg += ":" + port_path;
		}
		rdbg_args.push("--port=" + portArg);
		rdbg_args.push('--');
		rdbg_args.push(...execCommand.trim().split(' '));
		return rdbg_args;
	}

	getUnixRdbgArgs(exec_command: string, sockPath?: string) {
		const rdbg_args: string[] = [];
		rdbg_args.push('--command', '--open', '--stop-at-load');
		if (sockPath) {
			rdbg_args.push("--sock-path=" + sockPath);
		}
		rdbg_args.push('--');
		rdbg_args.push(...exec_command.trim().split(' '));
		return rdbg_args;
	}

	async launch_on_console(session: DebugSession): Promise<DebugAdapterDescriptor> {
		const config = session.configuration as LaunchConfiguration;
		const rdbg = config.rdbgPath || "rdbg";
		const debugConsole = vscode.debug.activeDebugConsole;

		// outputChannel.appendLine(JSON.stringify(session));

		let exec_command = '';
		try {
			exec_command = await this.getExecCommands(config);
		} catch (error) {
			if (error instanceof InvalidExecCommandError) {
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
			throw error;
		}
		const options: child_process.SpawnOptionsWithoutStdio = {
			env: { ...process.env, ...config.env },
			cwd: custom_path(config.cwd || ''),
		};
		if (process.platform === 'win32') options.shell = 'powershell';

		let sock_path: string | undefined = undefined;
		let tcp_host: string | undefined = undefined;
		let tcp_port: number | undefined = undefined;
		if (config.debugPort) {
			[tcp_host, tcp_port, sock_path] = this.parse_port(config.debugPort);
		}

		if (tcp_host !== undefined && tcp_port !== undefined) {
			const rdbg_args = this.getTCPRdbgArgs(exec_command, tcp_host, tcp_port);
			try {
				[, tcp_port] = await this.runDebuggeeWithTCP(debugConsole, rdbg, rdbg_args, options);
			} catch (error: any) {
				vscode.window.showErrorMessage(error.message);
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
			return new vscode.DebugAdapterServer(tcp_port, tcp_host);
		}
		const rdbg_args = this.getUnixRdbgArgs(exec_command, sock_path);
		try {
			sock_path = await this.runDebuggeeWithUnix(debugConsole, rdbg, rdbg_args, options);
		} catch (error: any) {
			vscode.window.showErrorMessage(error.message);
			return new DebugAdapterInlineImplementation(new StopDebugAdapter);
		}
		if (await this.wait_file(sock_path, config.waitLaunchTime)) {
			return new DebugAdapterNamedPipeServer(sock_path);
		}
		// failed
		return new DebugAdapterInlineImplementation(new StopDebugAdapter);
	}

	private colorMessage(message: string, colorCode: number) {
		return `\u001b[${colorCode}m${message}\u001b[0m`;
	}

	private readonly unixDomainRegex = /DEBUGGER:\sDebugger\scan\sattach\svia\s.+\((.+)\)/;
	private readonly colors = {
		red: 31,
		blue: 34
	};

	private async runDebuggeeWithUnix(debugConsole: vscode.DebugConsole, cmd: string, args?: string[] | undefined, options?: child_process.SpawnOptionsWithoutStdio) {
		pp(`Running: ${cmd} ${args?.join(' ')}`);
		let connectionReady = false;
		let sockPath = '';
		let stderr = '';
		return new Promise<string>((resolve, reject) => {
			const debugProcess = child_process.spawn(cmd, args, options);
			debugProcess.stderr.on('data', (chunk) => {
				const msg: string = chunk.toString();
				stderr += msg;
				if (stderr.includes('DEBUGGER: wait for debugger connection...')) {
					connectionReady = true;
				}
				const found = stderr.match(this.unixDomainRegex);
				if (found !== null && found.length === 2) {
					sockPath = found[1];
				}
				debugConsole.append(this.colorMessage(msg, this.colors.red));

				if (sockPath.length > 0 && connectionReady) {
					resolve(sockPath);
				}
			});
			debugProcess.stdout.on('data', (chunk) => {
				debugConsole.append(this.colorMessage(chunk.toString(), this.colors.blue));
			});
			debugProcess.on('error', (err) => {
				debugConsole.append(err.message);
				reject(err);
			});
			debugProcess.on('exit', (code) => {
				reject(new Error(`Couldn't start debug session. The debuggee process exited with code ${code}`));
			});
		});
	}

	private readonly TCPRegex = /DEBUGGER:\sDebugger\scan\sattach\svia\s.+\((.+):(\d+)\)/;

	private async runDebuggeeWithTCP(debugConsole: vscode.DebugConsole, cmd: string, args?: string[] | undefined, options?: child_process.SpawnOptionsWithoutStdio) {
		pp(`Running: ${cmd} ${args?.join(' ')}`);
		let connectionReady = false;
		let host = '';
		let port = -1;
		let stderr = '';
		return new Promise<[string, number]>((resolve, reject) => {
			const debugProcess = child_process.spawn(cmd, args, options);
			debugProcess.stderr.on('data', (chunk) => {
				const msg: string = chunk.toString();
				stderr += msg;
				if (stderr.includes('DEBUGGER: wait for debugger connection...')) {
					connectionReady = true;
				}
				const found = stderr.match(this.TCPRegex);
				if (found !== null && found.length === 3) {
					host = found[1];
					port = parseInt(found[2]);
				}
				debugConsole.append(this.colorMessage(msg, this.colors.red));

				if (host.length > 0 && port !== -1 && connectionReady) {
					resolve([host, port]);
				}
			});
			debugProcess.stdout.on('data', (chunk) => {
				debugConsole.append(this.colorMessage(chunk.toString(), this.colors.blue));
			});
			debugProcess.on('error', (err) => {
				debugConsole.append(err.message);
				reject(err);
			});
			debugProcess.on('exit', (code) => {
				reject(new Error(`Couldn't start debug session. The debuggee process exited with code ${code}`));
			});
		});
	}
}

class InvalidExecCommandError extends Error { }

interface AttachConfiguration extends DebugConfiguration {
	type: 'rdbg';
	request: 'attach';
	rdbgPath?: string;
	env?: { [key: string]: string };
	debugPort?: string;
	cwd?: string;
	showProtocolLog?: boolean;

	autoAttach?: string;
}

interface LaunchConfiguration extends DebugConfiguration {
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

	useTerminal?: boolean
}

