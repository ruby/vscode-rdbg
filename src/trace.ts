import * as vscode from "vscode";
import { BaseLogItem, LoadMoreItem, RdbgTreeItem, RdbgTreeItemOptions, RootLogItem, ThreadIdItem, ToggleTreeItem } from "./rdbgTreeItem";
import { TraceLogsResponse, TraceLog, RdbgTraceInspectorLogsArguments, TraceEventKind, TraceEventKindState, RdbgTraceInspectorDisableArguments, RdbgTraceInspectorEnableArguments, Location, BaseLog } from "./protocol";
import { customRequest, RdbgDecorationProvider } from "./utils";
import { TreeItemProvider } from "./treeItemProvider";

const locationIcon = new vscode.ThemeIcon("location");
const rdbgTraceInspectorCmd = "rdbgTraceInspector";

export function registerTraceProvider(ctx: vscode.ExtensionContext, emitter: vscode.EventEmitter<number | undefined>) {
	const treeProvider = new RdbgTraceInspectorTreeProvider();
	const view = vscode.window.createTreeView("rdbg.trace", { treeDataProvider: treeProvider });
	const inlayHintsProvider = new RdbgInlayHintsProvider(view);
	const eventState: TraceEventKindState = {
		line: true,
		call: true,
		return: true
	};
	const disposables: vscode.Disposable[] = [];
	const disp = RdbgDecorationProvider.create();
	if (disp) {
		disposables.push(disp);
	}

	disposables.push(
		vscode.languages.registerInlayHintsProvider(
			[
				{
					"language": "ruby"
				},
				{
					"language": "haml"
				},
				{
					"language": "slim"
				}
			],
			inlayHintsProvider
		),

		emitter.event((threadId) => {
			if (treeProvider.toggleTreeItem?.enabled) {
				treeProvider.updateTraceLogs(threadId);
			}
		}),

		vscode.debug.onDidTerminateDebugSession(async () => {
			vscode.commands.executeCommand("setContext", "traceInspectorEnabled", false);
			treeProvider.cleanUp();
		}),

		vscode.commands.registerCommand("rdbg.trace.openPrevLog", async () => {
			switch (true) {
				case view.selection.length < 1:
				case view.selection[0] instanceof TraceToggleTreeItem:
				case view.selection[0] instanceof RootLogItem:
					return;
			}
			const log = await treeProvider.getPrevLogItem(view.selection[0]);
			if (log !== undefined) {
				await view.reveal(log, { select: true, expand: 3 });
			}
		}),

		vscode.commands.registerCommand("rdbg.trace.openNextLog", async () => {
			switch (true) {
				case view.selection.length < 1:
				case view.selection[0] instanceof TraceToggleTreeItem:
				case view.selection[0] instanceof RootLogItem:
					return;
			}
			const log = treeProvider.getNextLogItem(view.selection[0]);
			if (log !== undefined) {
				await view.reveal(log, { select: true, expand: 3 });
			}
		}),

		vscode.commands.registerCommand("rdbg.trace.loadMoreLogs", (threadId) => {
			treeProvider.loadMoreTraceLogs(threadId);
		}),

		vscode.commands.registerCommand("rdbg.trace.toggle", async () => {
			const item = treeProvider.toggleTreeItem;
			if (item === undefined) {
				return;
			}
			await item.toggle();
			treeProvider.refresh();
		}),

		vscode.commands.registerCommand("rdbg.trace.disableLineEvent", () => {
			eventState.line = false;
			vscode.commands.executeCommand("setContext", "lineEventEnabled", false);
		}),

		vscode.commands.registerCommand("rdbg.trace.enableLineEvent", () => {
			eventState.line = true;
			vscode.commands.executeCommand("setContext", "lineEventEnabled", true);
		}),

		vscode.commands.registerCommand("rdbg.trace.disableCallEvent", () => {
			eventState.call = false;
			vscode.commands.executeCommand("setContext", "callEventEnabled", false);
		}),

		vscode.commands.registerCommand("rdbg.trace.enableCallEvent", () => {
			eventState.call = true;
			vscode.commands.executeCommand("setContext", "callEventEnabled", true);
		}),

		vscode.commands.registerCommand("rdbg.trace.disableReturnEvent", () => {
			eventState.return = false;
			vscode.commands.executeCommand("setContext", "returnEventEnabled", false);
		}),

		vscode.commands.registerCommand("rdbg.trace.enableReturnEvent", () => {
			eventState.return = true;
			vscode.commands.executeCommand("setContext", "returnEventEnabled", true);
		}),

		view.onDidChangeSelection(async (e) => {
			if (e.selection.length < 1) {
				return;
			}
			inlayHintsProvider.refresh();
			switch (true) {
				case e.selection[0] instanceof LineTraceLogItem || e.selection[0] instanceof CallTraceLogItem:
					const location = (e.selection[0] as TraceLogItem).location;
					const opts: vscode.TextDocumentShowOptions = {
						selection: new vscode.Range(location.line - 1, 0, location.line - 1, 0),
						preserveFocus: true 
					};
					await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(location.path), opts);
					break;
			}
		}),
	);

	vscode.commands.executeCommand("setContext", "traceInspectorEnabled", true);
	vscode.commands.executeCommand("setContext", "lineEventEnabled", true);
	vscode.commands.executeCommand("setContext", "callEventEnabled", true);
	vscode.commands.executeCommand("setContext", "returnEventEnabled", true);
	treeProvider.initTreeView(eventState);

	return disposables;
}

class RdbgTraceInspectorTreeProvider implements vscode.TreeDataProvider<RdbgTreeItem> {
	private _traceTreeMap = new Map<number, TraceLogTreeProvider>;
	private _toggleItem: TraceToggleTreeItem | undefined;
	private curThreadId: number | undefined;

	cleanUp() {
		this._traceTreeMap.clear();
		this.refresh();
	}

	get toggleTreeItem() {
		return this._toggleItem;
	}

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	async updateTraceLogs(threadId: number | undefined) {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return [];
		this.curThreadId = threadId;
		const args: RdbgTraceInspectorLogsArguments = {
			command: "collect"
		};
		const resp: TraceLogsResponse | undefined = await customRequest(session, rdbgTraceInspectorCmd, args);
		if (resp === undefined || resp.logs.length < 1) {
			return [];
		}
		this._traceTreeMap = this.toTraceTreeMap(resp.logs);
		this.refresh();
	}

	private toTraceTreeMap(logs: TraceLog[]) {
		const treeMap = new Map<number, TraceLogTreeProvider>;
		const logMap = this.toTraceLogMap(logs);
		logMap.forEach((logs, threadId) => {
			treeMap.set(threadId, new TraceLogTreeProvider(logs, threadId));
		});
		return new Map([...treeMap].sort((a, b) => a[0] - b[0]));
	}

	private toTraceLogMap(logs: TraceLog[]) {
		const map = new Map<number, TraceLog[]>;
		for (const log of logs) {
			const value = map.get(log.threadId);
			if (value === undefined) {
				map.set(log.threadId, [log]);
			} else {
				value.push(log);
				map.set(log.threadId, value);
			}
		}
		return map;
	}

	loadMoreTraceLogs(threadId: number) {
		const provider = this._traceTreeMap.get(threadId);
		provider?.loadMoreLogs();
		this.refresh();
	}

	async getPrevLogItem(selected: RdbgTreeItem) {
		if ("threadId" in selected && typeof selected.threadId === "number") {
			const provider = this._traceTreeMap.get(selected.threadId);
			return provider?.getPrevLogItem(selected);
		};
	}

	getNextLogItem(selected: RdbgTreeItem) {
		if ("threadId" in selected && typeof selected.threadId === "number") {
			const provider = this._traceTreeMap.get(selected.threadId);
			return provider?.getNextLogItem(selected);
		};
	}

	initTreeView(state: TraceEventKindState) {
		this._toggleItem = new TraceToggleTreeItem(state);
		this.refresh();
	}

	private _onDidChangeTreeData: vscode.EventEmitter<RdbgTreeItem | undefined | null | void> = new vscode.EventEmitter<RdbgTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<RdbgTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
	getTreeItem(element: RdbgTreeItem): RdbgTreeItem {
		return element;
	}

	async getChildren(element?: RdbgTreeItem): Promise<RdbgTreeItem[] | undefined> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return [];

		if (element) {
			return element.children;
		}
		// Do not await
		return this.createTree();
	}

	private async createTree() {
		const items: RdbgTreeItem[] = [];
		if (this._toggleItem !== undefined) {
			items.push(this._toggleItem);
		}
		if (this._traceTreeMap.size > 0) {
			const root = new RootLogItem("Trace");
			items.push(root);
		}
		const stack = items.concat();
		while (true) {
			const item = stack.pop();
			if (item === undefined) {
				break;
			}
			let children: RdbgTreeItem[] = [];
			switch (true) {
				case item instanceof ThreadIdItem:
					const tIdItem = item as ThreadIdItem;
					const provider = this._traceTreeMap.get(tIdItem.threadId);
					if (provider === undefined) {
						return [];
					}
					const tree = await provider.createTree();
					children = tree;
					this.setParentChild(children, item);
					break;
				case item instanceof RootLogItem:
					for (const threadId of this._traceTreeMap.keys()) {
						const item = new ThreadIdItem(threadId);
						if (threadId === this.curThreadId) {
							item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
						}
						children.push(item);
					}
					this.setParentChild(children, item);
					break;
			}
			for (const child of children) {
				if (child.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
					stack.push(child);
				}
			}
		}
		return items;
	}

	private async setParentChild(children: RdbgTreeItem[], parent: RdbgTreeItem) {
		parent.children = children;
		for (const child of children) {
			child.parent = parent;
		}
	}

	async getParent(element: RdbgTreeItem): Promise<RdbgTreeItem | null | undefined> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;

		return element.parent;
	}
}

class TraceLogTreeProvider extends TreeItemProvider {
	protected needLoading(item: RdbgTreeItem): boolean {
		return item.parent instanceof ThreadIdItem;
	}
	protected execLoadingCommand(threadId?: number | undefined): Thenable<void> {
		return vscode.commands.executeCommand("rdbg.trace.loadMoreLogs", threadId);
	}
	protected newLoadMoreItem(threadId?: number): LoadMoreItem {
		return new TraceLoadMoreItem(threadId);
	}
	protected newLogItem(log: BaseLog, idx: number, state: vscode.TreeItemCollapsibleState): BaseLogItem {
		const trace = log as TraceLog;
		if (trace.name) {
			return new CallTraceLogItem(trace, idx, state);
		}
		return new LineTraceLogItem(trace, idx, state);
	}
}

class TraceLogItem extends BaseLogItem {
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

class LineTraceLogItem extends TraceLogItem {
	constructor(
		log: TraceLog,
		idx: number,
		state?: vscode.TreeItemCollapsibleState,
	) {
		const label = log.location.path + ":" + log.location.line.toString();
		const opts: RdbgTreeItemOptions = { iconPath: locationIcon, collapsibleState: state };
		super(label, idx, log.depth, log.location, log.threadId, opts);
	}
}

class TraceLoadMoreItem extends LoadMoreItem {
	constructor(threadId?: number) {
		super("trace", threadId);
	}
}

class TraceToggleTreeItem extends ToggleTreeItem {
	constructor(private readonly state: TraceEventKindState) {
		super("Start Trace", "trace");
	}

	async disable(session: vscode.DebugSession) {
		super.enable(session);
		this.label = "Start Trace";
		const args: RdbgTraceInspectorDisableArguments = {
			command: "disable",
		};
		await customRequest(session, "rdbgTraceInspector", args);
	}

	async enable(session: vscode.DebugSession) {
		super.enable(session);
		this.label = "Stop Trace";
		const events: TraceEventKind[] = [];
		if (this.state.call) {
			events.push("call");
		}
		if (this.state.line) {
			events.push("line");
		}
		if (this.state.return) {
			events.push("return");
		}
		const args: RdbgTraceInspectorEnableArguments = {
			command: "enable",
			events
		};
		await customRequest(session, "rdbgTraceInspector", args);
	}
}

const arrowCircleRight = new vscode.ThemeIcon("arrow-circle-right");
const arrowCircleLeft = new vscode.ThemeIcon("arrow-circle-left");
class CallTraceLogItem extends TraceLogItem {
	public readonly returnValue: string | undefined;
	constructor(
		log: TraceLog,
		idx: number,
		state?: vscode.TreeItemCollapsibleState,
	) {
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
	}
}

class RdbgInlayHintsProvider implements vscode.InlayHintsProvider {
	private readonly _singleSpace = " ";
	private readonly _indent = this._singleSpace.repeat(5);
	private readonly _arrow = "#=>";
	constructor(
		private readonly _treeView: vscode.TreeView<RdbgTreeItem>
	) {}
	private _onDidChangeInlayHints: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	readonly onDidChangeInlayHints: vscode.Event<void> = this._onDidChangeInlayHints.event;
	provideInlayHints(document: vscode.TextDocument, _range: vscode.Range, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.InlayHint[]> {
		const hints: vscode.InlayHint[] = [];
		if (this._treeView.selection.length < 1) {
			return hints;
		}
		const selection = this._treeView.selection[0];
		if (selection instanceof CallTraceLogItem && selection.returnValue !== undefined) {
			const line = selection.location.line - 1;
			const text = document.lineAt(line);
			const label = this._indent + this._arrow + this._singleSpace + selection.returnValue;
			const hint = new vscode.InlayHint(text.range.end, label, vscode.InlayHintKind.Parameter);
			hints.push(hint);
		}
		return hints;
	}
	refresh() {
		this._onDidChangeInlayHints.fire();
	}
}
