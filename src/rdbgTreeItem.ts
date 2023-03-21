import * as vscode from "vscode";
import { Location } from "./protocol";

const foldUpIcon = new vscode.ThemeIcon("fold-up", new vscode.ThemeColor("textLink.foreground"));

export type RdbgTreeItemOptions = Pick<vscode.TreeItem, "id" | "iconPath" | "collapsibleState" | "description" | "tooltip" | "resourceUri"> & {
	command?: {command: string, arguments?: any[]};
};

export class RdbgTreeItem extends vscode.TreeItem {
	public parent?: RdbgTreeItem;
	public children?: RdbgTreeItem[];
	constructor(
		label: string | vscode.TreeItemLabel,
		opts: RdbgTreeItemOptions = {}
	) {
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

export class LoadMoreItem extends RdbgTreeItem {
	constructor(kind: string, threadId?: number) {
		super("Load More Logs", {
			command: { command: kind + ".loadMoreLogs", arguments: [threadId] },
			resourceUri: vscode.Uri.parse("http://example.com"),
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			iconPath: foldUpIcon,
		});
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
		opts.tooltip = location.path + ":" + location.line.toString();
		super(label, opts);
	}
}

export class OmittedItem extends RdbgTreeItem {
	constructor(
		public readonly index: number,
		public readonly offset: number,
		public readonly depth: number,
		public readonly threadId?: number,
	) {
		super("..", { collapsibleState: vscode.TreeItemCollapsibleState.Expanded });
	}
}

export class RootLogItem extends RdbgTreeItem {
	constructor(
		kind: string
	){
		super(kind + " Logs", { collapsibleState: vscode.TreeItemCollapsibleState.Expanded });
	}
}

export class ThreadIdItem extends RdbgTreeItem {
	constructor(
		public readonly threadId: number,
	){
		super("Thread ID: " + threadId.toString(), { collapsibleState: vscode.TreeItemCollapsibleState.Collapsed });
	}
}

const playCircleIcon = new vscode.ThemeIcon("play-circle");
const stopCircleIcon = new vscode.ThemeIcon("stop-circle");
export class ToggleTreeItem extends RdbgTreeItem {
	protected _enabled = false;
	constructor(
		label: string,
		kind: string
	){
		super(label, {
			command: { command: kind + ".toggle" },
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			iconPath: playCircleIcon
		});
	}

	async toggle() {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) {
			return;
		}
		if (this._enabled) {
			this.disable(session);
		} else {
			this.enable(session);
		}
	}

	async enable(_session: vscode.DebugSession) {
		this.iconPath = stopCircleIcon;
		this._enabled = true;
	}

	async disable(_session: vscode.DebugSession) {
		this.iconPath = playCircleIcon;
		this._enabled = false;
	}
}
