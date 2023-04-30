import * as vscode from "vscode";
import {
	Location,
	RdbgInspectorDisableArguments,
	RdbgInspectorEnableArguments,
	RecordLog,
	TraceEventKind,
	RdbgInspectorConfig,
	TraceLog,
	RdbgInspectorCommand,
	BaseLog,
} from "./protocol";
import { customRequest } from "./utils";

export type RdbgTreeItemOptions = Pick<
	vscode.TreeItem,
	"id" | "iconPath" | "collapsibleState" | "description" | "tooltip" | "resourceUri"
> & {
	command?: { command: string; arguments?: any[] };
};

export class RdbgTreeItem extends vscode.TreeItem {
	public parent?: RdbgTreeItem;
	public children?: RdbgTreeItem[];
	constructor(label: string | vscode.TreeItemLabel, opts: RdbgTreeItemOptions = {}) {
		super(label, opts.collapsibleState);
		this.id = opts.id;
		this.iconPath = opts.iconPath;
		this.tooltip = opts.tooltip;
		this.description = opts.description;
		this.resourceUri = opts.resourceUri;
		if (opts.command) {
			const command = "rdbg." + opts.command.command;
			this.command = { title: command, command, arguments: opts.command.arguments };
		}
	}
}

export class BaseLogItem extends RdbgTreeItem {
	constructor(
		label: string | vscode.TreeItemLabel,
		public readonly index: number,
		public readonly depth: number,
		public readonly location: Location,
		opts: RdbgTreeItemOptions = {},
	) {
		super(label, opts);
	}
}

export class OmittedItem extends RdbgTreeItem {
	constructor(
		public readonly offset: number,
		public readonly depth: number,
		public readonly threadId?: number,
	) {
		super("..", { collapsibleState: vscode.TreeItemCollapsibleState.Collapsed });
	}
}

export class RootLogItem extends RdbgTreeItem {
	constructor(kind: string) {
		super(kind + " Logs", { collapsibleState: vscode.TreeItemCollapsibleState.Expanded });
	}
}

export class ThreadIdItem extends RdbgTreeItem {
	constructor(public readonly threadId: number) {
		super("Thread ID: " + threadId.toString(), { collapsibleState: vscode.TreeItemCollapsibleState.Collapsed });
	}
}

export class RecordLogItem extends BaseLogItem {
	constructor(
		label: string | vscode.TreeItemLabel,
		public readonly index: number,
		public readonly depth: number,
		public readonly location: Location,
		public readonly parameters: RecordLog["parameters"],
		state: vscode.TreeItemCollapsibleState,
		opts: RdbgTreeItemOptions = {},
	) {
		const description = location.path + ":" + location.line;
		opts.collapsibleState = state;
		opts.description = description;
		super(label, index, depth, location, opts);
		this.id = index.toString();
	}
}

export class TraceLogItem extends BaseLogItem {
	constructor(
		label: string,
		public readonly index: number,
		public readonly depth: number,
		public readonly location: Location,
		public readonly threadId: number,
		opts: RdbgTreeItemOptions = {},
	) {
		super(label, index, depth, location, opts);
	}
}

const locationIcon = new vscode.ThemeIcon("location");

export class LineTraceLogItem extends TraceLogItem {
	constructor(log: TraceLog, idx: number, state?: vscode.TreeItemCollapsibleState) {
		const label = log.location.path + ":" + log.location.line.toString();
		const opts: RdbgTreeItemOptions = { iconPath: locationIcon, collapsibleState: state };
		super(label, idx, log.depth, log.location, log.threadId, opts);
	}
}

const arrowCircleRight = new vscode.ThemeIcon("arrow-circle-right");
const arrowCircleLeft = new vscode.ThemeIcon("arrow-circle-left");
export class CallTraceLogItem extends TraceLogItem {
	public readonly returnValue: TraceLog["returnValue"];
	public readonly parameters: TraceLog["parameters"];
	constructor(log: TraceLog, idx: number, state?: vscode.TreeItemCollapsibleState) {
		let iconPath: vscode.ThemeIcon;
		if (log.returnValue) {
			iconPath = arrowCircleLeft;
		} else {
			iconPath = arrowCircleRight;
		}
		const description = log.location.path + ":" + log.location.line;
		const opts: RdbgTreeItemOptions = { iconPath: iconPath, collapsibleState: state, description };
		super(log.name || "Unknown frame name", idx, log.depth, log.location, log.threadId, opts);
		this.returnValue = log.returnValue;
		this.parameters = log.parameters;
		this.tooltip = this.createToolTipValue(log);
	}
	createToolTipValue(log: BaseLog) {
		const tooltip = new vscode.MarkdownString();
		if (log.returnValue) {
			tooltip.appendCodeblock(log.name || "");
			tooltip.appendCodeblock(`#=> ${this.truncateString(log.returnValue)}`);
			tooltip.appendText(`@${log.location.path}:${log.location.line}`);
		} else {
			tooltip.appendCodeblock(log.name || "");
			if (log.parameters) {
				if (log.parameters.length > 1) {
					tooltip.appendCodeblock("(");
					for (const param of log.parameters) {
						tooltip.appendCodeblock(`  ${param.name} = ${this.truncateString(param.value)},`);
					}
					tooltip.appendCodeblock(")");
				} else {
					tooltip.appendCodeblock(`(${log.parameters[0].name} = ${log.parameters[0].value})`);
				}
			}
			tooltip.appendText(`@${log.location.path}:${log.location.line}`);
		}
		return tooltip;
	}
	private truncateString(str: string) {
		if (str.length > 256) {
			return str.substring(0, 256) + "...";
		}
		return str;
	}
}

const playCircleIcon = new vscode.ThemeIcon("play-circle");
const stopCircleIcon = new vscode.ThemeIcon("stop-circle");
export class ToggleTreeItem extends RdbgTreeItem {
	private _enabled = false;
	private _enabledCommand: RdbgInspectorCommand | undefined;
	constructor(private readonly config: RdbgInspectorConfig) {
		super("Enable Trace", {
			command: { command: "inspector.toggle" },
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			iconPath: playCircleIcon,
		});
	}

	get enabled(): boolean {
		return this._enabled;
	}

	async toggle() {
		if (this._enabled) {
			this.disable();
		} else {
			this.enable();
		}
	}

	async enable() {
		this.iconPath = stopCircleIcon;
		this._enabled = true;
		this.label = "Disable Trace";
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) {
			return;
		}
		const events: TraceEventKind[] = [];
		let args: RdbgInspectorEnableArguments;
		const maxLogSize = vscode.workspace.getConfiguration("rdbg").get<number>("maxTraceLogSize") || 50000;
		if (this.config.recordAndReplay) {
			this._enabledCommand = "record";
			args = {
				command: this._enabledCommand,
				subCommand: "enable",
				maxLogSize: maxLogSize,
			};
		} else {
			this._enabledCommand = "trace";
			if (this.config.traceCall) {
				events.push("traceCall");
				const traceReturn = vscode.workspace.getConfiguration("rdbg").get<boolean>("enableTraceReturnValue");
				if (traceReturn) {
					events.push("traceReturn");
					if (this.config.traceClanguageCall) {
						events.push("traceClanguageReturn")
					}
				}
				const traceParams = vscode.workspace.getConfiguration("rdbg").get<boolean>("enableTraceParameters");
				if (traceParams) {
					events.push("traceParams");
				}
			}
			if (this.config.traceLine) {
				events.push("traceLine");
			}
			if (this.config.traceClanguageCall) {
				events.push("traceClanguageCall")
			}
			args = {
				command: this._enabledCommand,
				subCommand: "enable",
				events,
				maxLogSize: maxLogSize,
			};
		}
		if (this.config.filterRegExp) {
			args.filterRegExp = this.config.filterRegExp;
		}
		await customRequest(session, "rdbgTraceInspector", args);
	}

	async resetView() {
		this._enabled = false;
		this.iconPath = playCircleIcon;
		this.label = "Enable Trace";
	}

	async disable() {
		this.resetView();
		const session = vscode.debug.activeDebugSession;
		if (session === undefined || this._enabledCommand === undefined) {
			return;
		}
		const args: RdbgInspectorDisableArguments = {
			command: this._enabledCommand,
			subCommand: "disable",
		};
		await customRequest(session, "rdbgTraceInspector", args);
		this._enabledCommand = undefined;
	}
}
