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
let last_exec_command: string | undefined;
let last_program: string | undefined;

function workspace_folder(): string | undefined {
	if (vscode.workspace.workspaceFolders) {
		for (const ws of vscode.workspace.workspaceFolders) {
			return ws.uri.fsPath;
		}
	}
}

function export_breakpoints(context: vscode.ExtensionContext) {
	if (vscode.workspace.getConfiguration("rdbg.saveBreakpoints")) {
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
			fs.writeFile(path.join(wspath, ".rdbgrc.breakpoints"), bp_lines, e => { });
			outputChannel.appendLine(bp_lines);
		}
	}
}


export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('rdbg');

	vscode.debug.breakpoints;

	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('rdbg', new RdbgInitialConfigurationProvider()));
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('rdbg', new RdbgAdapterDescriptorFactory()));

	//
	context.subscriptions.push(vscode.debug.onDidChangeBreakpoints(e => {
		export_breakpoints(context);
	}));
}

export function deactivate() {
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
		if (session.configuration.request == 'attach') {
			return this.attach(session);
		}
		else {
			return this.launch(session);
		}
	}

	async get_sock_list(config: AttachConfiguration): Promise<string[]> {
		const rdbg = config.rdbgPath || "/home/ko1/src/rb/ruby-debug/exe/rdbg";
		const execFile = util.promisify(require('child_process').execFile);
		async function f() {
			const { stdout } = await execFile(rdbg, ['--util=list-socks']);
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

	show_error(msg: string): void {
		outputChannel.appendLine("Error: " + msg);
		outputChannel.appendLine("Make sure to install rdbg command (`gem install debug`).\n" +
		                         "If you are using bundler, write `gem 'debug'` in your Gemfile.");
		outputChannel.show();
	}

	async get_sock_path(rdbg: string): Promise<string | null> {
		return new Promise((resolve) => {
			const p = child_process.execFile(rdbg, ['--util=gen-sockpath']);
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

	async launch(session: DebugSession): Promise<DebugAdapterDescriptor> {
		const config = session.configuration as LaunchConfiguration;
		const rdbg = config.rdbgPath || "/home/ko1/src/rb/ruby-debug/exe/rdbg";

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
		let outputTerminal: vscode.Terminal | undefined;
		for (const t of vscode.window.terminals) {
			if (t.name == "rdbg" && !t.exitStatus) {
				outputTerminal = t;
			}
		}

		if (!outputTerminal) {
			outputTerminal = vscode.window.createTerminal({ name: "rdbg" });
		}

		vscode.window.showInformationMessage(JSON.stringify(config));

		const rdbg_args = rdbg + " --command --open --sock-path=" + sock_path + " -- ";
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

			const cmdline = rdbg_args + exec_command;

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
					vscode.window.showErrorMessage("Couldn't start debug session (wait for " + (Date.now() - start_time) + " ms)");
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

