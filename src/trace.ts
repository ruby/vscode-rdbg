import * as vscode from "vscode";
import { LoadMoreItem, OmittedItem, RdbgTreeItem, RdbgTreeItemOptions, RootLogItem, ThreadIdItem, ToggleTreeItem, TraceLogItem } from "./rdbgTreeItem";
import { TraceLogsResponse, TraceLog, RdbgTraceInspectorLogsArguments, TraceEventKind, TraceEventKindState, RdbgTraceInspectorDisableArguments, RdbgTraceInspectorEnableArguments } from "./traceLog";
import { customRequest } from "./utils";

const locationIcon = new vscode.ThemeIcon("location");
const rdbgTraceInspectorCmd = "rdbgTraceInspector";

export function registerTraceProvider(ctx: vscode.ExtensionContext, emitter: vscode.EventEmitter<number | undefined>) {
	const treeProvider = new RdbgTraceInspectorTreeProvider();
	const decorationProvider = new RdbgDecorationProvider();
	const view = vscode.window.createTreeView("rdbg.trace", { treeDataProvider: treeProvider });
	const inlayHintsProvider = new RdbgInlayHintsProvider(view);
	const eventState: TraceEventKindState = {
		line: true,
		call: true,
		return: true
	};

	const disposables: vscode.Disposable[] = [
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
		vscode.window.registerFileDecorationProvider(decorationProvider),

		emitter.event((threadId) => {
			treeProvider.updateTraceLogs(threadId);
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

		vscode.commands.registerCommand("rdbg.trace.toggleTrace", async () => {
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
	];

	vscode.commands.executeCommand("setContext", "traceInspectorEnabled", true);
	vscode.commands.executeCommand("setContext", "lineEventEnabled", true);
	vscode.commands.executeCommand("setContext", "callEventEnabled", true);
	vscode.commands.executeCommand("setContext", "returnEventEnabled", true);
	treeProvider.initTreeView(eventState);

	return disposables;
}

const initRowCount = 100;
const loadingRowCount = 80;
const push = Array.prototype.push;

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
		provider?.loadMoreTraceLogs();
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
			const root = new RootLogItem();
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

class TraceLogTreeProvider {
	private _traceLogs: TraceLogItem[] = [];
	private _loadMoreOffset: number = -1;
	private _minDepth = Infinity;
	private _omittedItems: OmittedItem[] = [];

	constructor(logs: TraceLog[], private readonly _threadId: number) {
		this._traceLogs = this.toTraceLogItems(logs);
		let quotient = Math.floor(logs.length / initRowCount);
		let remainder = logs.length % initRowCount;
		if (quotient === 0) {
			quotient = 1;
			remainder = 0;
		}
		this._loadMoreOffset = initRowCount * (quotient - 1) + remainder;
		this._minDepth = this.getMinDepth(logs);
	}

	private clearArray(ary: any[]) {
		while(ary.length > 0) {
			ary.pop();
		}
	}

	private topItem(idx: number) {
		return idx === this._loadMoreOffset;
	}

	private getTopTraceLogItem() {
		return this._traceLogs[this._loadMoreOffset];
	}

	private getBottomTraceLogItem() {
		return this._traceLogs[this._traceLogs.length - 1];
	}

	getTraceLogItem(idx: number) {
		return this._traceLogs[idx];
	}

	private getOmittedItem(idx: number) {
		return this._omittedItems[idx];
	}

	getNextLogItem(selected: RdbgTreeItem) {
		let idx: number;
		let item: RdbgTreeItem;
		switch (true) {
			case selected instanceof LineTraceLogItem:
			case selected instanceof CallTraceLogItem:
				idx = (selected as TraceLogItem).index;
				item = this.getTraceLogItem(idx + 1);
				return item;
			case selected instanceof OmittedItem:
				idx = (selected as OmittedItem).index;
				item = this.getOmittedItem(idx + 1) || this.getTopTraceLogItem();
				return item;
		}
	}

	async getPrevLogItem(selected: RdbgTreeItem) {
		let idx: number;
		let item: RdbgTreeItem | undefined;
		switch (true) {
			case selected instanceof TraceLogItem:
				const traceItem = selected as TraceLogItem;
				idx = traceItem.index;
				if (this.topItem(idx)) {
					if (selected.parent instanceof ThreadIdItem) {
						await vscode.commands.executeCommand("rdbg.trace.loadMoreLogs", traceItem.threadId);
						item = this.getTraceLogItem(idx - 1);
					} else {
						item = selected.parent;
					}
				} else {
					item = this.getTraceLogItem(idx - 1);
				}
				return item;
			case selected instanceof OmittedItem:
				const omitItem = selected as OmittedItem;
				idx = this._loadMoreOffset;
				if (selected.parent instanceof ThreadIdItem) {
					await vscode.commands.executeCommand("rdbg.trace.loadMoreLogs", omitItem.threadId);
					item = this.getTraceLogItem(idx - 1);
				} else {
					item = selected.parent;
				}
				return item;
		}
	}

	loadMoreTraceLogs() {
		this._loadMoreOffset -= loadingRowCount;
		if (this._loadMoreOffset < 0) {
			this._loadMoreOffset = 0;
		}
	}

	private hasChild(logs: TraceLog[], index: number) {
		const target = logs[index];
		return logs[index + 1] && logs[index + 1].depth > target.depth;
	}

	public async createTree() {
		this.clearArray(this._omittedItems);
		const items: RdbgTreeItem[] = [];
		if (this._loadMoreOffset !== 0) {
			items.push(new TraceLoadMoreItem(this._threadId));
		}
		const logs = this._traceLogs.slice(this._loadMoreOffset);
		if (logs[0].depth > this._minDepth) {
			const omitted = new OmittedItem(0, this._loadMoreOffset, this._minDepth, this._threadId);
			this._omittedItems.push(omitted);
			items.push(omitted);
		}
		const traceItem = this.listTraceLogItems(logs, this._minDepth);
		push.apply(items, traceItem);
		const stack = items.concat();
		while (true) {
			const item = stack.pop();
			if (item === undefined) {
				break;
			}
			let children: RdbgTreeItem[] = [];
			let subArray: TraceLogItem[];
			let childLogs: TraceLogItem[];
			let childEnd: number;
			let childMinDepth = Infinity;
			let traceItem: TraceLogItem[];
			switch (true) {
				case item instanceof TraceLogItem:
					const idx = (item as TraceLogItem).index;
					subArray = this._traceLogs.slice(idx + 1);
					childEnd = subArray.length;
					for (let i = 0; i < subArray.length; i++) {
						if (subArray[i].depth <= this._traceLogs[idx].depth) {
							childEnd = i;
							break;
						}									 
					}
					childLogs = subArray.slice(0, childEnd);
					childMinDepth = this.getMinDepth(childLogs);
					children = this.listTraceLogItems(childLogs, childMinDepth);
					// Do not await
					this.setParentChild(children, item);
					break;
				case item instanceof OmittedItem:
					const omitted = item as OmittedItem;
					subArray = this._traceLogs.slice(omitted.offset);
					childEnd = subArray.length;
					for (let i = 0; i < subArray.length; i++) {
						if (subArray[i].depth === omitted.depth) {
							childEnd = i;
							break;
						}
					}
					childLogs = subArray.slice(0, childEnd);
					childMinDepth = this.getMinDepth(childLogs);
					if (childLogs[0].depth > childMinDepth) {
						const o = new OmittedItem(omitted.index + 1, this._loadMoreOffset, childMinDepth, this._threadId);
						this._omittedItems.push(o);
						children.push(o);
					}
					traceItem = this.listTraceLogItems(childLogs, childMinDepth);
					push.apply(children, traceItem);
					// Do not await
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

	private toTraceLogItems(logs: TraceLog[]) {
		const items: TraceLogItem[] = [];
		logs.forEach((log, idx) => {
			let state = vscode.TreeItemCollapsibleState.None;
			if (this.hasChild(logs, idx)) {
				state = vscode.TreeItemCollapsibleState.Expanded;
			}
			let item: TraceLogItem;
			if (log.name) {
				item = new CallTraceLogItem(log, idx, state);
			} else {
				item = new LineTraceLogItem(log, idx, state);
			}
			items.push(item);
		});
		return items;
	}

	private listTraceLogItems(logs: TraceLogItem[], depth: number) {
		const root: TraceLogItem[] = [];
		for (const log of logs) {
			if (log.depth === depth) {
				root.push(log);
			}
		}
		return root;
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

	private getMinDepth(logs: TraceLogItem[]) {
		let min = Infinity;
		for (const log of logs) {
			if (log.depth < min) {
				min = log.depth;
			}
		}
		return min;
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
	constructor(threadId: number) {
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

class RdbgDecorationProvider implements vscode.FileDecorationProvider {
	provideFileDecoration(uri: vscode.Uri, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
		if (uri.toString() !== vscode.Uri.parse("http://example.com").toString()) {
			return void 0;
		}
		return {
			color: new vscode.ThemeColor("textLink.foreground")
		};
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
