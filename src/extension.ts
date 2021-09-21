import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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
					bp_lines = bp_lines + "break " + path + ":" + start_line + "\n"
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
				outputChannel.appendLine("[Error on seession]\n" + JSON.stringify(e));
			}
		}
		if (session.configuration.showProtocolLog) {
			tracker.onDidSendMessage = (message: any): void => {
				outputChannel.appendLine("[VSCode->DA] " + JSON.stringify(message));
			}
			tracker.onWillReceiveMessage = (message: any): void => {
				outputChannel.appendLine("[DA->VSCode] " + JSON.stringify(message));
			}
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
			const { stdout } = await exec(cmd);
			if (stdout.length > 0) {
				return stdout.split("\n");
			}
			else {
				return [];
			}
		}
		return f();
	}

	async attach(session: DebugSession): Promise<DebugAdapterDescriptor> {
		const config = session.configuration as AttachConfiguration;
		const list = await this.get_sock_list(config);

		outputChannel.appendLine(JSON.stringify(list));

		switch (list.length) {
			case 0:
				vscode.window.showErrorMessage("Can not find attachable Ruby process.");
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			case 1:
				return new DebugAdapterNamedPipeServer(list[0]);
			default:
				const sock = await vscode.window.showQuickPick(list);
				if (sock) {
					return new DebugAdapterNamedPipeServer(sock);
				}
				else {
					return new DebugAdapterInlineImplementation(new StopDebugAdapter);
				}
		}
	}

	async get_sock_path(rdbg: string): Promise<string | null> {
		return new Promise((resolve) => {
			const command = this.make_shell_command(rdbg + " --util=gen-sockpath");
			const p = child_process.exec(command);
			let path: string;

			p.on('error', e => {
				this.show_error(e.message);
				resolve(null);
			});
			p.on('exit', (code) => {
				if (code != 0) {
					this.show_error("exit code is " + code);
					resolve(null);
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

	async get_version(rdbg: string): Promise<string | null> {
		return new Promise((resolve) => {
			const command = this.make_shell_command(rdbg + " --version");
			const p = child_process.exec(command);
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

	async launch(session: DebugSession): Promise<DebugAdapterDescriptor> {
		const config = session.configuration as LaunchConfiguration;
		const rdbg = config.rdbgPath || "rdbg";

		// outputChannel.appendLine(JSON.stringify(session));

		const sock_path = await this.get_sock_path(rdbg);

		if (!sock_path) {
			return new DebugAdapterInlineImplementation(new StopDebugAdapter);
		}
		if (fs.existsSync(sock_path)) {
			vscode.window.showErrorMessage("already exists: " + sock_path);
			return new DebugAdapterInlineImplementation(new StopDebugAdapter);
		}
		outputChannel.appendLine("sock-path: <" + sock_path + ">");

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

		const rdbg_args = rdbg + " --command --open --stop-at-load --sock-path=" + sock_path + " -- ";
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

			const cmdline = this.env_prefix(config.env) + rdbg_args + exec_command;

			if (outputTerminal) {
				outputTerminal.show(false);
				outputTerminal.sendText(cmdline);
			}

			// check sock-path
			const start_time = Date.now();
			let i = 0;
			while (!fs.existsSync(sock_path)) {
				i++;
				if (i > 30) {
					const version: string | null = await this.get_version(rdbg);

					if (version && this.vernum(version) < this.vernum("rdbg 1.2.0")) {
						vscode.window.showErrorMessage("rdbg 1.2.0 is required (" + version + " is used). Please update debug.gem.");
					}
					else {
						vscode.window.showErrorMessage("Couldn't start debug session (wait for " + (Date.now() - start_time) + " ms). Please install debug.gem.");
					}
					return new DebugAdapterInlineImplementation(new StopDebugAdapter);
				}
				await new Promise((resolve, reject) => {
					setTimeout(() => {
						resolve(0);
					}, 100); // ms
				});
			}

			return new DebugAdapterNamedPipeServer(sock_path);
		}
		else {
			return new DebugAdapterInlineImplementation(new StopDebugAdapter);
		}
	}
}

interface AttachConfiguration extends DebugConfiguration {
	type: 'rdbg';
	request: 'attach';
	rdbgPath?: string;
	showProtocolLog?: boolean;
}

interface LaunchConfiguration extends DebugConfiguration {
	type: 'rdbg';
	request: 'launch';

	script: string;

	command?: string; // ruby
	cwd?: string;
	args?: string[];
	env?: { [key: string]: string };

	useBundler?: boolean;
	askParameters?: boolean;

	rdbgPath?: string;
	showProtocolLog?: boolean;
}

