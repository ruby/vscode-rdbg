import * as child_process from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { stringify } from 'querystring';
import * as util from 'util';
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
} from 'vscode';

let outputChannel: vscode.OutputChannel;
let outputTerminal: vscode.Terminal | undefined;
let last_exec_command: string | undefined;
let last_program: string | undefined;

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
					const start_line = bp.location.range.start.line;
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

	vscode.debug.breakpoints;

	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('rdbg', new RdbgInitialConfigurationProvider()));
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('rdbg', new RdbgAdapterDescriptorFactory()));
	context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('rdbg', new RdbgDebugAdapterTrackerFactory()));

	//
	context.subscriptions.push(vscode.debug.onDidChangeBreakpoints(e => {
		export_breakpoints(context);
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
		}

		const json_path = path.join(folders[0].uri.path, ".vscode/rdbg_autoattach.json");
		if (fs.existsSync(json_path)) {
			const c: AttachConfiguration = require(json_path);

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
				if (outputTerminal) {
					outputTerminal.show();
				}
			},
			onError(e) {
				outputChannel.appendLine("[Error on seession]\n" + e.name + ": " + e.message + "\ne: " + JSON.stringify(e));
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

class RdbgAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): Promise<DebugAdapterDescriptor> {
		// session.configuration.internalConsoleOptions = "neverOpen"; // TODO: doesn't affect...

		if (session.configuration.request == 'attach') {
			return this.attach(session);
		}
		else {
			return this.launch(session);
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
		const exec = util.promisify(require('child_process').exec);
		const cmd = this.make_shell_command(rdbg + ' --util=list-socks');

		async function f() {
			const { stdout } = await exec(cmd, {cwd: config.cwd ? custom_path(config.cwd) : workspace_folder()});
			if (stdout.length > 0) {
				let socks: Array<string> = [];
				for (const line of stdout.split("\n")) {
					if (line.length > 0) {
						socks.push(line);
					}
				}
				return socks;
			}
			else {
				return [];
			}
		}
		return f();
	}

	parse_port(port: string) : [string | undefined, number | undefined, string | undefined] {
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
			const p = child_process.exec(command, {cwd: config.cwd ? custom_path(config.cwd) : workspace_folder()});
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
			const p = child_process.exec(command, {cwd: config.cwd ? custom_path(config.cwd) : workspace_folder()});
			let path: string;

			p.on('error', e => {
				resolve(undefined);
			});
			p.on('exit', (code) => {
				resolve(path);
			});
			p.stderr?.on('data', err => {
				outputChannel.appendLine(err);
			})
			p.stdout?.on('data', out => {
				path = out.trim();
			});
		});
	}

	async get_version(config: LaunchConfiguration): Promise<string | null> {
		return new Promise((resolve) => {
			const rdbg = config.rdbgPath || "rdbg";
			const command = this.make_shell_command(rdbg + " --version");
			const p = child_process.exec(command, {cwd: config.cwd ? custom_path(config.cwd) : workspace_folder()});
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

	env_prefix(env?: {[key: string]: string}): string {
		if (env) {
			let prefix = "";
			for (const key in env) {
				prefix += key + "='" + env[key] + "' ";
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

	async wait_file(path: string): Promise<boolean> {
		// check sock-path
		const start_time = Date.now();
		let i = 0;
		while (!fs.existsSync(path)) {
			i++;
			if (i > 30) {
				vscode.window.showErrorMessage("Couldn't start debug session (wait for " + (Date.now() - start_time) + " ms). Please install debug.gem.");
				return false;
			}
			await this.sleep_ms(100);
		}
		return true;
	}

	async launch(session: DebugSession): Promise<DebugAdapterDescriptor> {
		const config = session.configuration as LaunchConfiguration;
		const rdbg = config.rdbgPath || "rdbg";

		// outputChannel.appendLine(JSON.stringify(session));

		// setup debugPort
		let sock_path : string | undefined;
		let tcp_host : string | undefined;
		let tcp_port : number | undefined;
		let tcp_port_file : string | undefined;

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
		outputTerminal = undefined;

		for (const t of vscode.window.terminals) {
			if (t.name == "rdbg" && !t.exitStatus) {
				outputTerminal = t;
			}
		}

		if (!outputTerminal) {
			const shell = process.env.SHELL;
			const shell_args = this.support_login(shell) ? ['-l'] : undefined;

			outputTerminal = vscode.window.createTerminal({
				name: "rdbg",
				shellPath: shell,
				shellArgs: shell_args,
			});
		}

		const connection_parameter = () => {
			if (sock_path) {
				return "--sock-path=" + sock_path;
			}
			else {
				const port_option = "--port=" + tcp_port + (tcp_port_file ? (":" + tcp_port_file) : "");

				if (tcp_host) {
					return port_option + " --host=" + tcp_host;
				}
				else {
					return port_option;
				}
			}
		}

		const rdbg_args = rdbg + " --command --open --stop-at-load " + connection_parameter() + " -- ";
		const useBundlerFlag = (config.useBundler != undefined) ? config.useBundler : vscode.workspace.getConfiguration("rdbg").get("useBundler");
		const useBundler = useBundlerFlag && fs.existsSync(workspace_folder() + '/Gemfile');
		const ruby_command = config.command ? config.command : (useBundler ? 'bundle exec ruby' : 'ruby');
		let exec_args = config.script + " " + (config.args ? config.args.join(' ') : '');
		let exec_command: string | undefined = ruby_command + ' ' + exec_args;

		// launch rdbg
		if (config.askParameters) {
			if (last_exec_command && last_program == config.script) {
				exec_command = last_exec_command;
			}

			exec_command = await vscode.window.showInputBox({
				"title": "Debug command line",
				"value": exec_command
			});
		}

		if (exec_command) {
			last_exec_command = exec_command;
			last_program = config.script;
			const cmdline = this.env_prefix(config.env) + (config.noDebug ? '' : rdbg_args) + exec_command;

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
				if (await this.wait_file(sock_path)) {
					return new DebugAdapterNamedPipeServer(sock_path);
				}
				else {
					return new DebugAdapterInlineImplementation(new StopDebugAdapter);
				}
			}
			else if (tcp_port != undefined) {
				if (tcp_port_file) {
					if (await this.wait_file(tcp_port_file)) {
						const port_str = fs.readFileSync(tcp_port_file);
						tcp_port = parseInt(port_str.toString());
					}
					else {
						return new DebugAdapterInlineImplementation(new StopDebugAdapter);
					}
				}
				else {
					const wait_ms = config.waitLaunchTime ? config.waitLaunchTime : 1000 /* 1 sec */;
					await this.sleep_ms(wait_ms);
				}

				return new vscode.DebugAdapterServer(tcp_port, tcp_host);
			}
		}

		// failed
		return new DebugAdapterInlineImplementation(new StopDebugAdapter);
	}
}

interface AttachConfiguration extends DebugConfiguration {
	type: 'rdbg';
	request: 'attach';
	rdbgPath?: string;
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
}

