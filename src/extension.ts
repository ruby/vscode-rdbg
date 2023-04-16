import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import * as vscode from "vscode";
import { promisify } from "util";

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
	ThemeIcon,
	EventEmitter
} from "vscode";

import { DebugProtocol } from "@vscode/debugprotocol";
import { registerInspectorView } from "./inspector";
import { AttachConfiguration, LaunchConfiguration } from "./config";

const asyncExec = promisify(child_process.exec);

enum VersionManager {
	Asdf = "asdf",
	Chruby = "chruby",
	Rbenv = "rbenv",
	Rvm = "rvm",
	Shadowenv = "shadowenv",
	None = "none",
}

let outputChannel: vscode.OutputChannel;
const outputTerminals = new Map<string, vscode.Terminal>();
let lastExecCommand: string | undefined;
let lastProgram: string | undefined;

const terminalName: string = "Ruby Debug Terminal";

function workspaceFolder(): string | undefined {
	if (vscode.workspace.workspaceFolders) {
		for (const ws of vscode.workspace.workspaceFolders) {
			return ws.uri.fsPath;
		}
	}
}

function customPath(workingDirectory: string): string {
	if (path.isAbsolute(workingDirectory)) {
		return workingDirectory;
	} else {
		const wspath = workspaceFolder();

		if (wspath) {
			return path.join(wspath, workingDirectory);
		} else {
			return workingDirectory;
		}
	}
}

function pp(obj: any) {
	outputChannel.appendLine(JSON.stringify(obj));
}

function exportBreakpoints() {
	if (vscode.workspace.getConfiguration("rdbg").get("saveBreakpoints")) {
		const wspath = workspaceFolder();

		if (wspath) {
			var bpLines = "";
			for (const bp of vscode.debug.breakpoints) {
				if (bp instanceof vscode.SourceBreakpoint && bp.enabled) {
					// outputChannel.appendLine(JSON.stringify(bp));
					const startLine = bp.location.range.start.line + 1;
					const path = bp.location.uri.path;
					bpLines = bpLines + "break " + path + ":" + startLine + "\n";
				}
			}
			const bpPath = path.join(wspath, ".rdbgrc.breakpoints");
			fs.writeFile(bpPath, bpLines, () => { });
			outputChannel.appendLine("Written: " + bpPath);
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel("rdbg");

	const adapterDescriptorFactory = new RdbgAdapterDescriptorFactory(context);
	const stopppedEvtEmitter = new EventEmitter<number | undefined>();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("rdbg", new RdbgInitialConfigurationProvider()));
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory("rdbg", adapterDescriptorFactory));
	context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory("rdbg", new RdbgDebugAdapterTrackerFactory(stopppedEvtEmitter)));

	//
	context.subscriptions.push(vscode.debug.onDidChangeBreakpoints(() => {
		exportBreakpoints();
	}));

	context.subscriptions.push(vscode.debug.onDidStartDebugSession(async session => {
		const config = session.configuration;
		if (config.request !== "launch" || config.useTerminal || config.noDebug) return;

		const args: DebugProtocol.EvaluateArguments = {
			expression: ",eval $stdout.sync=true",
			context: "repl"
		};
		try {
			await session.customRequest("evaluate", args);
		} catch (err) {
			// We need to ignore the error because this request will be failed if the version of rdbg is older than 1.7. The `,command` API is introduced from version 1.7.
			pp(err);
		}
	}));

	const folders = vscode.workspace.workspaceFolders;

	if (folders !== undefined && folders.length > 0) {
		const autoAttachConfigP = (c: AttachConfiguration): boolean => {
			if (c.type === "rdbg" && c.request === "attach" && c.autoAttach) {
				if (c.autoAttach === process.env.RUBY_DEBUG_AUTOATTACH) {
					return true;
				}

				vscode.window.showErrorMessage(".vscode/rdbg_autoattach.json contains unexpected contents. Please check integrity.");
			}
			return false;
		};

		const jsonPath = path.join(folders[0].uri.fsPath, ".vscode/rdbg_autoattach.json");
		if (fs.existsSync(jsonPath)) {
			const c: AttachConfiguration = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

			if (autoAttachConfigP(c)) {
				fs.unlinkSync(jsonPath);
				vscode.debug.startDebugging(folders[0], c);
				return;
			}
		}
	}

	let disposables: vscode.Disposable[] = [];
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession((session) => {
			const traceEnabled = vscode.workspace.getConfiguration("rdbg").get<boolean>("enableRdbgTraceInspector");
			if (traceEnabled) {
				const config = session.configuration as LaunchConfiguration;
				adapterDescriptorFactory.getVersion(config).then((strVer) => {
					if (strVer === null) return;
					const version = adapterDescriptorFactory.vernum(strVer);
					// checks the version of debug.gem is 1.8.0 or higher.
					if (version >= 1008000) {
						if (traceEnabled) {
							disposables = disposables.concat(registerInspectorView(stopppedEvtEmitter));
						}
					}
				});
			}
		}),

		vscode.debug.onDidTerminateDebugSession(() => {
			while(disposables.length > 0) {
				const disp = disposables.pop();
				disp?.dispose();
			}
		})
	);
}

export function deactivate() {
}

class RdbgDebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
	constructor(
		public readonly _emitter: vscode.EventEmitter<number | undefined>,
	) {}
	createDebugAdapterTracker(session: DebugSession): ProviderResult<vscode.DebugAdapterTracker> {
		const self = this;
		const tracker: vscode.DebugAdapterTracker = {
			onWillStartSession(): void {
				outputChannel.appendLine("[Start session]\n" + JSON.stringify(session));
			},
			onWillStopSession(): void {
				const outputTerminal = outputTerminals.get(session.id);
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
				self.stoppedEvtPublisher(message);
				outputChannel.appendLine("[DA->VSCode] " + JSON.stringify(message));
			};
			tracker.onWillReceiveMessage = (message: any): void => {
				outputChannel.appendLine("[VSCode->DA] " + JSON.stringify(message));
			};
		} else {
			tracker.onDidSendMessage = (message: any): void => {
				self.stoppedEvtPublisher(message);
			};
		}
		return tracker;
	}

	private stoppedEvtPublisher(message: any) {
		if (message.event === "stopped") {
			const evt = message as DebugProtocol.StoppedEvent;
			const threadId = evt.body.threadId;
			this._emitter.fire(threadId);
		}
	}
}

class RdbgInitialConfigurationProvider implements vscode.DebugConfigurationProvider {
	resolveDebugConfiguration(_folder: WorkspaceFolder | undefined, config: DebugConfiguration, _token?: CancellationToken): ProviderResult<DebugConfiguration> {
		const extension = [];
		const traceEnabled = vscode.workspace.getConfiguration("rdbg").get<boolean>("enableRdbgTraceInspector");
		if (traceEnabled) {
			extension.push("traceInspector");
		}
		config.rdbgExtension = extension;

		if (config.script || config.request === "attach") {
			return config;
		}

		if (Object.keys(config).length > 0 && !config.script)
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return null;
			});

		// launch without configuration
		if (vscode.window.activeTextEditor?.document.languageId !== "ruby")
			return vscode.window.showInformationMessage("Select a ruby file to debug").then(_ => {
				return null;
			});

		return {
			type: "rdbg",
			name: "Launch",
			request: "launch",
			script: "${file}",
			askParameters: true,
		};
	};

	provideDebugConfigurations(_folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
		return [
			{
				type: "rdbg",
				name: "Debug current file with rdbg",
				request: "launch",
				script: "${file}",
				args: [],
				askParameters: true,
			},
			{
				type: "rdbg",
				name: "Attach with rdbg",
				request: "attach",
			}
		];
	};
}

class StopDebugAdapter implements vscode.DebugAdapter {
	private sendMessage = new vscode.EventEmitter<any>();
	readonly onDidSendMessage: vscode.Event<any> = this.sendMessage.event;

	handleMessage(): void {
		const ev = {
			type: "event",
			seq: 1,
			event: "terminated",
		};
		this.sendMessage.fire(ev);
	}

	dispose() {
	}
}

const findRDBGTerminal = (): vscode.Terminal | undefined => {
	let terminal: vscode.Terminal | undefined;
	const currentTerminals: vscode.Terminal[] = Array.from(outputTerminals.values());
	for (const t of vscode.window.terminals) {
		if (t.name === terminalName && !t.exitStatus && !currentTerminals.includes(t)) {
			terminal = t;
			break;
		}
	}
	return terminal;
};

class RdbgAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	private context: vscode.ExtensionContext;
	private rubyActivated: boolean;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.rubyActivated = false;
	}

	async createDebugAdapterDescriptor(session: DebugSession, _executable: DebugAdapterExecutable | undefined): Promise<DebugAdapterDescriptor> {
		// session.configuration.internalConsoleOptions = "neverOpen"; // TODO: doesn't affect...
		const c = session.configuration;
		const cwd = c.cwd ? customPath(c.cwd) : workspaceFolder();
		await this.activateRuby(cwd);

		// Reactivate the Ruby environment in case .ruby-version, Gemfile or Gemfile.lock changes
		if (cwd) {
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(cwd, "{.ruby-version,Gemfile,Gemfile.lock}")
			);
			this.context.subscriptions.push(watcher);
			watcher.onDidChange(() => this.activateRuby(cwd));
			watcher.onDidCreate(() => this.activateRuby(cwd));
			watcher.onDidDelete(() => this.activateRuby(cwd));
		}

		if (c.request === "attach") {
			return this.attach(session);
		}
		else {
			// launch
			if (c.useTerminal || c.noDebug) {
				return this.launchOnTerminal(session);
			}
			else {
				return this.launchOnConsole(session);
			}
		}
	}

	showError(msg: string): void {
		outputChannel.appendLine("Error: " + msg);
		outputChannel.appendLine("Make sure to install rdbg command (`gem install debug`).\n" +
			"If you are using bundler, write `gem 'debug'` in your Gemfile.");
		outputChannel.show();
	}

	supportLogin(shell: string | undefined) {
		if (shell && (shell.endsWith("bash") || shell.endsWith("zsh") || shell.endsWith("fish"))) {
			return true;
		}
		else {
			return false;
		}
	}

	makeShellCommand(cmd: string) {
		const shell = process.env.SHELL;
		if (!this.rubyActivated && this.supportLogin(shell)) {
			return shell + " -lic '" + cmd + "'";
		} else {
			return cmd;
		}
	}

	// Activate the Ruby environment variables using a version manager
	async activateRuby(cwd: string | undefined) {
		this.rubyActivated = false;
		const manager: VersionManager | undefined = vscode.workspace.getConfiguration("rdbg").get("rubyVersionManager");
		let command;

		try {
			switch (manager) {
				case VersionManager.Asdf:
					command = this.makeShellCommand('asdf exec ruby');
					await this.injectRubyEnvironment(command, cwd);
					break;
				case VersionManager.Rbenv:
					command = this.makeShellCommand('rbenv exec ruby');
					await this.injectRubyEnvironment(command, cwd);
					break;
				case VersionManager.Rvm:
					command = this.makeShellCommand('rvm-auto-ruby');
					await this.injectRubyEnvironment(command, cwd);
					break;
				case VersionManager.Chruby:
					const rubyVersion = fs.readFileSync(path.join(cwd!, ".ruby-version"), "utf8").trim();
					command = this.makeShellCommand(`chruby-exec "${rubyVersion}" -- ruby`);
					await this.injectRubyEnvironment(command, cwd);
					break;
				case VersionManager.Shadowenv:
					await vscode.extensions
						.getExtension("shopify.vscode-shadowenv")
						?.activate();
					await this.sleepMs(500);
					break;
				default:
					return;
			}
			this.rubyActivated = true;
		} catch (error) {
			this.showError(`Failed to activate Ruby environment using ${manager}. Error: ${error}`);
		}
	}

	async injectRubyEnvironment(command: string, cwd?: string) {
		// Print the current environment after activating it with a version manager, so that we can inject it into the node
		// process. We wrap the environment JSON in `RUBY_ENV_ACTIVATE` to make sure we extract only the JSON since some
		// terminal/shell combinations may print extra characters in interactive mode
		const result = await asyncExec(`${command} -rjson -e "printf(%{RUBY_ENV_ACTIVATE%sRUBY_ENV_ACTIVATE}, JSON.dump(ENV.to_h))"`, {
			cwd,
			env: process.env
		});

		const envJson = result.stdout.match(
			/RUBY_ENV_ACTIVATE(.*)RUBY_ENV_ACTIVATE/
		)![1];

		process.env = JSON.parse(envJson);
	}

	async getSockList(config: AttachConfiguration): Promise<string[]> {
		const rdbg = config.rdbgPath || "rdbg";
		const cmd = this.makeShellCommand(rdbg + " --util=list-socks");
		return new Promise((resolve, reject) => {
			child_process.exec(cmd, {
				cwd: config.cwd ? customPath(config.cwd) : workspaceFolder(),
				env: { ...process.env, ...config.env }
			}, (err, stdout, stderr) => {
				if (err || stderr) {
					reject(err ?? stderr);
				} else {
					const socks: Array<string> = [];
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

	parsePort(port: string): [string | undefined, number | undefined, string | undefined] {
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
		let sockPath: string | undefined;

		if (config.noDebug) {
			vscode.window.showErrorMessage("Can not attach \"Without debugging\".");
			return new DebugAdapterInlineImplementation(new StopDebugAdapter);
		}

		if (config.debugPort) {
			[host, port, sockPath] = this.parsePort(config.debugPort);
		}
		else {
			const list = await this.getSockList(config);
			outputChannel.appendLine(JSON.stringify(list));

			switch (list.length) {
				case 0:
					vscode.window.showErrorMessage("Can not find attachable Ruby process.");
					return new DebugAdapterInlineImplementation(new StopDebugAdapter);
				case 1:
					sockPath = list[0];
					break;
				default:
					const sock = await vscode.window.showQuickPick(list);
					if (sock) {
						sockPath = sock;
					}
					else {
						return new DebugAdapterInlineImplementation(new StopDebugAdapter);
					}
			}
		}

		if (sockPath) {
			return new DebugAdapterNamedPipeServer(sockPath);
		}
		else if (port) {
			return new vscode.DebugAdapterServer(port, host);
		}
		else {
			vscode.window.showErrorMessage("Unrechable.");
			return new DebugAdapterInlineImplementation(new StopDebugAdapter);
		}
	}

	getSockPath(config: LaunchConfiguration): Promise<string | undefined> {
		return new Promise((resolve) => {
			const rdbg = config.rdbgPath || "rdbg";
			const command = this.makeShellCommand(rdbg + " --util=gen-sockpath");
			const p = child_process.exec(command, {
				cwd: config.cwd ? customPath(config.cwd) : workspaceFolder(),
				env: { ...process.env, ...config.env }
			});
			let path: string;

			p.on("error", e => {
				this.showError(e.message);
				resolve(undefined);
			});
			p.on("exit", (code) => {
				if (code !== 0) {
					this.showError("exit code is " + code);
					resolve(undefined);
				}
				else {
					resolve(path);
				}
			});
			p.stderr?.on("data", err => {
				outputChannel.appendLine(err);
			});
			p.stdout?.on("data", out => {
				path = out.trim();
			});
		});
	}

	getTcpPortFile(config: LaunchConfiguration): Promise<string | undefined> {
		return new Promise((resolve) => {
			const rdbg = config.rdbgPath || "rdbg";
			const command = this.makeShellCommand(rdbg + " --util=gen-portpath");
			const p = child_process.exec(command, {
				cwd: config.cwd ? customPath(config.cwd) : workspaceFolder(),
				env: { ...process.env, ...config.env }
			});
			let path: string;

			p.on("error", () => {
				resolve(undefined);
			});
			p.on("exit", () => {
				resolve(path);
			});
			p.stderr?.on("data", err => {
				outputChannel.appendLine(err);
			});
			p.stdout?.on("data", out => {
				path = out.trim();
			});
		});
	}

	getVersion(config: LaunchConfiguration): Promise<string | null> {
		return new Promise((resolve) => {
			const rdbg = config.rdbgPath || "rdbg";
			const command = this.makeShellCommand(rdbg + " --version");
			const p = child_process.exec(command, {
				cwd: config.cwd ? customPath(config.cwd) : workspaceFolder(),
				env: { ...process.env, ...config.env }
			});
			let version: string;

			p.on("error", e => {
				this.showError(e.message);
				resolve(null);
			});
			p.on("exit", (code) => {
				if (code !== 0) {
					this.showError(command + ": exit code is " + code);
					resolve(null);
				}
				else {
					resolve(version);
				}
			});
			p.stderr?.on("data", err => {
				outputChannel.appendLine(err);
			});
			p.stdout?.on("data", out => {
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

	envPrefix(env?: { [key: string]: string }): string {
		if (env) {
			let prefix = "";
			if (process.platform === "win32") {
				for (const key in env) {
					prefix += "$Env:" + key + "='" + env[key] + "'; ";
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

	sleepMs(waitMs: number) {
		return new Promise((resolve) => setTimeout(resolve, waitMs));
	}

	async waitTcpPortFile(path: string, waitMs: number | undefined) {
		return this.waitUntil(()=> {
			return fs.existsSync(path) && fs.readFileSync(path).toString().length > 0;
		}, waitMs);
	}

	async waitFile(path: string, waitMs: number | undefined): Promise<boolean> {
		return this.waitUntil(()=> {
			return fs.existsSync(path);
		}, waitMs);
	}

	async waitUntil(condition: () => boolean, waitMs: number | undefined) {
		let iterations: number = 50;
		if (waitMs) {
			iterations = waitMs / 100;
		}

		const startTime = Date.now();
		let i = 0;
		while (true) {
			i++;
			if (i > iterations) {
				vscode.window.showErrorMessage("Couldn't start debug session (wait for " + (Date.now() - startTime) + " ms). Please install debug.gem.");
				return false;
			}
			if (condition()) {
				return true;
			}
			await this.sleepMs(100);
		}
	}

	getRandomPort() {
		const server = net.createServer();
		server.listen(0);
		const addr = server.address() as net.AddressInfo;
		const port = addr.port;
		server.close();
		return port;
	}

	async launchOnTerminal(session: DebugSession): Promise<DebugAdapterDescriptor> {
		const config = session.configuration as LaunchConfiguration;
		const rdbg = config.rdbgPath || "rdbg";

		// outputChannel.appendLine(JSON.stringify(session));

		// setup debugPort
		let sockPath: string | undefined;
		let tcpHost: string | undefined;
		let tcpPort: number | undefined;
		let tcpPortFile: string | undefined;

		if (config.debugPort) {
			[tcpHost, tcpPort, sockPath] = this.parsePort(config.debugPort);

			if (process.platform === "win32" && tcpPort === 0) {
				tcpPort = this.getRandomPort();
			} else if (tcpPort !== undefined) {
				tcpPortFile = await this.getTcpPortFile(config);
			}
		} else if (process.platform === "win32") {
			// default
			tcpHost = "localhost";
			tcpPort = this.getRandomPort();
		} else {
			sockPath = await this.getSockPath(config);
			if (!sockPath) {
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
			if (fs.existsSync(sockPath)) {
				vscode.window.showErrorMessage("already exists: " + sockPath);
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
			outputChannel.appendLine("sock-path: <" + sockPath + ">");
		}

		// setup terminal
		let outputTerminal = findRDBGTerminal();

		if (!outputTerminal) {
			const shell = process.env.SHELL;
			const shellArgs = this.supportLogin(shell) ? ["-l"] : undefined;

			outputTerminal = vscode.window.createTerminal({
				name: terminalName,
				shellPath: shell,
				shellArgs: shellArgs,
				message: `Created by vscode-rdbg at ${new Date()}`,
				iconPath: new ThemeIcon("ruby")
			});
		}
		outputTerminals.set(session.id, outputTerminal);

		let execCommand = "";
		try {
			execCommand = await this.getExecCommands(config);
		} catch (error) {
			if (error instanceof InvalidExecCommandError) {
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
			throw error;
		}

		let cmdline = this.envPrefix(config.env);

		if (config.noDebug) {
			cmdline += execCommand;
		} else {
			let rdbgArgs: string[];
			if (tcpHost !== undefined && tcpPort !== undefined) {
				rdbgArgs = this.getTCPRdbgArgs(execCommand, tcpHost, tcpPort, tcpPortFile);
			} else {
				rdbgArgs = this.getUnixRdbgArgs(execCommand, sockPath);
			}
			cmdline += rdbg + " " + rdbgArgs.join(" ");
		}

		if (outputTerminal) {
			outputTerminal.show(false);

			if (config.cwd) {
				// Ensure we are in the requested working directory
				const cdCommand = "cd " + customPath(config.cwd);
				outputTerminal.sendText(cdCommand);
			}

			outputTerminal.sendText(cmdline);
		}

		if (config.noDebug) {
			return new DebugAdapterInlineImplementation(new StopDebugAdapter);
		}

		// use NamedPipe
		if (sockPath) {
			if (await this.waitFile(sockPath, config.waitLaunchTime)) {
				return new DebugAdapterNamedPipeServer(sockPath);
			}
			else {
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
		}
		else if (tcpPort !== undefined) {
			if (tcpPortFile) {
				if (await this.waitTcpPortFile(tcpPortFile, config.waitLaunchTime)) {
					const portStr = fs.readFileSync(tcpPortFile);
					tcpPort = parseInt(portStr.toString());
				}
				else {
					return new DebugAdapterInlineImplementation(new StopDebugAdapter);
				}
			}
			else {
				const waitMs = config.waitLaunchTime ? config.waitLaunchTime : 5000 /* 5 sec */;
				await this.sleepMs(waitMs);
			}
			return new vscode.DebugAdapterServer(tcpPort, tcpHost);
		}

		// failed
		return new DebugAdapterInlineImplementation(new StopDebugAdapter);
	}

	async getExecCommands(config: LaunchConfiguration) {
		const useBundlerFlag = (config.useBundler !== undefined) ? config.useBundler : vscode.workspace.getConfiguration("rdbg").get("useBundler");
		const useBundler = useBundlerFlag && fs.existsSync(workspaceFolder() + "/Gemfile");
		const rubyCommand = config.command ? config.command : (useBundler ? "bundle exec ruby" : "ruby");
		const execArgs = config.script + " " + (config.args ? config.args.join(" ") : "");
		let execCommand: string | undefined = rubyCommand + " " + execArgs;

		if (config.askParameters) {
			if (lastExecCommand && lastProgram === config.script) {
				execCommand = lastExecCommand;
			}

			execCommand = await vscode.window.showInputBox({
				"title": "Debug command line",
				"value": execCommand
			});
		}
		if (execCommand === undefined || execCommand.length <= 0) {
			throw new InvalidExecCommandError();
		}
		// Save the history of command and script to use next time in `config.askParameters`.
		lastExecCommand = execCommand;
		lastProgram = config.script;

		return execCommand;
	}

	getTCPRdbgArgs(execCommand: string, host: string, port: number, portPath?: string) {
		const rdbgArgs: string[] = [];
		rdbgArgs.push("--command", "--open", "--stop-at-load");
		rdbgArgs.push("--host=" + host);
		let portArg = port.toString();
		if (portPath) {
			portArg += ":" + portPath;
		}
		rdbgArgs.push("--port=" + portArg);
		rdbgArgs.push("--");
		rdbgArgs.push(...execCommand.trim().split(" "));
		return rdbgArgs;
	}

	getUnixRdbgArgs(execCommand: string, sockPath?: string) {
		const rdbgArgs: string[] = [];
		rdbgArgs.push("--command", "--open", "--stop-at-load");
		if (sockPath) {
			rdbgArgs.push("--sock-path=" + sockPath);
		}
		rdbgArgs.push("--");
		rdbgArgs.push(...execCommand.trim().split(" "));
		return rdbgArgs;
	}

	async launchOnConsole(session: DebugSession): Promise<DebugAdapterDescriptor> {
		const config = session.configuration as LaunchConfiguration;
		const rdbg = config.rdbgPath || "rdbg";
		const debugConsole = vscode.debug.activeDebugConsole;

		// outputChannel.appendLine(JSON.stringify(session));

		let execCommand = "";
		try {
			execCommand = await this.getExecCommands(config);
		} catch (error) {
			if (error instanceof InvalidExecCommandError) {
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
			throw error;
		}
		const options: child_process.SpawnOptionsWithoutStdio = {
			env: { ...process.env, ...config.env },
			cwd: customPath(config.cwd || ""),
		};
		if (process.platform === "win32") options.shell = "powershell";

		let sockPath: string | undefined = undefined;
		let tcpHost: string | undefined = undefined;
		let tcpPort: number | undefined = undefined;

		if (config.debugPort) {
			[tcpHost, tcpPort, sockPath] = this.parsePort(config.debugPort);
		}
		else if (process.platform === "win32") {
			// default
			tcpHost = "localhost";
			tcpPort = 0;
		}

		if (tcpHost !== undefined && tcpPort !== undefined) {
			const rdbgArgs = this.getTCPRdbgArgs(execCommand, tcpHost, tcpPort);
			try {
				[, tcpPort] = await this.runDebuggeeWithTCP(debugConsole, rdbg, rdbgArgs, options);
			} catch (error: any) {
				vscode.window.showErrorMessage(error.message);
				return new DebugAdapterInlineImplementation(new StopDebugAdapter);
			}
			return new vscode.DebugAdapterServer(tcpPort, tcpHost);
		}
		const rdbgArgs = this.getUnixRdbgArgs(execCommand, sockPath);
		try {
			sockPath = await this.runDebuggeeWithUnix(debugConsole, rdbg, rdbgArgs, options);
		} catch (error: any) {
			vscode.window.showErrorMessage(error.message);
			return new DebugAdapterInlineImplementation(new StopDebugAdapter);
		}
		if (await this.waitFile(sockPath, config.waitLaunchTime)) {
			return new DebugAdapterNamedPipeServer(sockPath);
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

	private runDebuggeeWithUnix(debugConsole: vscode.DebugConsole, cmd: string, args?: string[] | undefined, options?: child_process.SpawnOptionsWithoutStdio) {
		pp(`Running: ${cmd} ${args?.join(" ")}`);
		let connectionReady = false;
		let sockPath = "";
		let stderr = "";
		return new Promise<string>((resolve, reject) => {
			const debugProcess = child_process.spawn(cmd, args, options);
			debugProcess.stderr.on("data", (chunk) => {
				const msg: string = chunk.toString();
				stderr += msg;
				if (stderr.includes("Error")) {
					reject(new Error(stderr));
				}
				if (stderr.includes("DEBUGGER: wait for debugger connection...")) {
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
			debugProcess.stdout.on("data", (chunk) => {
				debugConsole.append(this.colorMessage(chunk.toString(), this.colors.blue));
			});
			debugProcess.on("error", (err) => {
				debugConsole.append(err.message);
				reject(err);
			});
			debugProcess.on("exit", (code) => {
				reject(new Error(`Couldn't start debug session. The debuggee process exited with code ${code}`));
			});
		});
	}

	private readonly TCPRegex = /DEBUGGER:\sDebugger\scan\sattach\svia\s.+\((.+):(\d+)\)/;

	private runDebuggeeWithTCP(debugConsole: vscode.DebugConsole, cmd: string, args?: string[] | undefined, options?: child_process.SpawnOptionsWithoutStdio) {
		pp(`Running: ${cmd} ${args?.join(" ")}`);
		let connectionReady = false;
		let host = "";
		let port = -1;
		let stderr = "";
		return new Promise<[string, number]>((resolve, reject) => {
			const debugProcess = child_process.spawn(cmd, args, options);
			debugProcess.stderr.on("data", (chunk) => {
				const msg: string = chunk.toString();
				stderr += msg;
				if (stderr.includes("Error")) {
					reject(new Error(stderr));
				}
				if (stderr.includes("DEBUGGER: wait for debugger connection...")) {
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
			debugProcess.stdout.on("data", (chunk) => {
				debugConsole.append(this.colorMessage(chunk.toString(), this.colors.blue));
			});
			debugProcess.on("error", (err) => {
				debugConsole.append(err.message);
				reject(err);
			});
			debugProcess.on("exit", (code) => {
				reject(new Error(`Couldn't start debug session. The debuggee process exited with code ${code}`));
			});
		});
	}
}

class InvalidExecCommandError extends Error { }
