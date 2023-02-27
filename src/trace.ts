import * as vscode from 'vscode';
import { LoadMoreItem, OmittedItem, RdbgTreeItem, RdbgTreeItemOptions, RootLogItem, ToggleTreeItem, TraceLogItem } from './rdbgTreeItem';
import { TraceLogsResponse, TraceLog, RdbgTraceInspectorLogsArguments } from './traceLog';

const locationIcon = new vscode.ThemeIcon('location');

export function registerTraceProvider(ctx: vscode.ExtensionContext) {
	const treeProvider = new TraceLogsTreeProvider();
	const decorationProvider = new RdbgDecorationProvider(treeProvider);
	const view = vscode.window.createTreeView('rdbg.trace', { treeDataProvider: treeProvider });
	const inlayHintsProvider = new RdbgInlayHintsProvider(view);

	ctx.subscriptions.push(
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

		vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
			switch (event.event) {
				case 'rdbgTraceInspector':
					treeProvider.updateTraceLogs();
					break;
			}
		}),

		vscode.debug.onDidStartDebugSession(async () => {
			treeProvider.initTreeView();
		}),

		vscode.debug.onDidTerminateDebugSession(async () => {
			treeProvider.cleanUp();
		}),

		vscode.commands.registerCommand('rdbg.trace.openPrevLog', async () => {
			switch (true) {
				case view.selection.length < 1:
				case view.selection[0] instanceof ToggleTreeItem:
				case view.selection[0] instanceof RootLogItem:
					const bottom = treeProvider.getBottomTraceLogItem();
					await view.reveal(bottom);
					return;
			}
			const log = await treeProvider.getPrevLogItem(view.selection[0]);
			if (log !== undefined) {
				await view.reveal(log);
			}
		}),

		vscode.commands.registerCommand('rdbg.trace.openNextLog', async () => {
			if (view.selection.length < 1) {
				return;
			}
			const log = treeProvider.getNextLogItem(view.selection[0]);
			if (log !== undefined) {
				await view.reveal(log);
			}
		}),

		vscode.commands.registerCommand('rdbg.loadMoreLogs', () => {
			treeProvider.loadMoreTraceLogs();
		}),

		vscode.commands.registerCommand('rdbg.toggleTrace', () => {
			const item = treeProvider.toggleTreeItem;
			if (item === undefined) {
				return;
			}
			item.toggle();
			treeProvider.refresh();
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
					await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(location.path), opts);
					break;
			}
		}),
	);
}

const initRowCount = 5;
const loadingRowCount = 3;
const push = Array.prototype.push;

class TraceLogsTreeProvider implements vscode.TreeDataProvider<RdbgTreeItem> {
	private _traceLogs: TraceLogItem[] = [];
	private _loadMoreOffset: number = -1;
	private _minDepth = Infinity;
	private _omittedItems: OmittedItem[] = [];
	private _toggleItem: ToggleTreeItem | undefined;

	cleanUp() {
  	this._loadMoreOffset = -1;
  	this._minDepth = Infinity;
  	this.clearArray(this._traceLogs);
  	this.clearArray(this._omittedItems);
  	this.refresh();
	}

	private clearArray(ary: any[]) {
  	while(ary.length > 0) {
  		ary.pop();
  	}
	}

	get toggleTreeItem() {
		return this._toggleItem;
	}

	refresh() {
  	this._onDidChangeTreeData.fire();
	}

	async updateTraceLogs() {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return [];
		let resp: TraceLogsResponse;
		try {
			const args: RdbgTraceInspectorLogsArguments = {
				command: 'logs'
			};
			resp = await session.customRequest('rdbgTraceInspector', args);
		} catch (error) {
			return [];
		}
		if (resp.logs === undefined || resp.logs.length < 1) {
			return [];
		}
	  this._traceLogs = await this.toTraceLogItems(resp.logs);
		let quotient = Math.floor(this._traceLogs.length / initRowCount);
		let remainder = this._traceLogs.length % initRowCount;
		if (quotient === 0) {
			quotient = 1;
			remainder = 0;
		}
		this._loadMoreOffset = initRowCount * (quotient - 1) + remainder;
		this._minDepth = this.getMinDepth(this._traceLogs);
		this.refresh();
	}

	loadMoreTraceLogs() {
		this._loadMoreOffset -= loadingRowCount;
		if (this._loadMoreOffset < 0) {
			this._loadMoreOffset = 0;
		}
		this.refresh();
	}

	private topItem(idx: number) {
  	return idx === this._loadMoreOffset;
	}

	private getTopTraceLogItem() {
  	return this._traceLogs[this._loadMoreOffset];
	}

	getBottomTraceLogItem() {
  	return this._traceLogs[this._traceLogs.length - 1];
	}

	getTraceLogItem(idx: number) {
  	return this._traceLogs[idx];
	}

	async getPrevLogItem(selected: RdbgTreeItem) {
  	let idx: number;
  	let item: RdbgTreeItem | undefined;
  	switch (true) {
  		case selected instanceof LineTraceLogItem:
			case selected instanceof CallTraceLogItem:
  			idx = (selected as TraceLogItem).index;
  			if (this.topItem(idx)) {
  				if (selected.parent instanceof RootLogItem) {
  					await vscode.commands.executeCommand('rdbg.loadMoreLogs');
  					item = this.getTraceLogItem(idx - 1);
  				} else {
  					item = selected.parent;
  				}
  			} else {
  				item = this.getTraceLogItem(idx - 1);
  			}
  			return item;
  		case selected instanceof OmittedItem:
  			idx = this._loadMoreOffset;
  			if (selected.parent instanceof RootLogItem) {
  				await vscode.commands.executeCommand('rdbg.loadMoreLogs');
  				item = this.getTraceLogItem(idx - 1);
  			} else {
  				item = selected.parent;
  			}
  			return item;
  	}
	}

	getNextLogItem(selected: RdbgTreeItem) {
  	let idx: number;
  	let item: RdbgTreeItem;
  	switch (true) {
  		case selected instanceof LineTraceLogItem || selected instanceof CallTraceLogItem:
  			idx = (selected as TraceLogItem).index;
  			item = this.getTraceLogItem(idx + 1);
  			return item;
  		case selected instanceof OmittedItem:
  			idx = (selected as OmittedItem).index;
  			item = this.getOmittedItem(idx + 1) || this.getTopTraceLogItem();
  			return item;
  	}
	}

	initTreeView() {
		this._toggleItem = new ToggleTreeItem();
		this.refresh();
	}

	private getOmittedItem(idx: number) {
  	return this._omittedItems[idx];
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
		this.clearArray(this._omittedItems);
		// Do not await
		return this.createTree();
	}

	private async toTraceLogItems(logs: TraceLog[]) {
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

	private getMinDepth(logs: TraceLogItem[]) {
		let min = Infinity;
		for (const log of logs) {
			if (log.depth < min) {
				min = log.depth;
			}
		}
		return min;
	}

	private async createTree() {
		const items: RdbgTreeItem[] = [];
		if (this._toggleItem !== undefined) {
			items.push(this._toggleItem);
		}
		if (this._traceLogs.length > 0) {
			const root = new RootLogItem();
			items.push(root);
		}
		const stack = items.concat();
		while (true) {
			const item = stack.pop();
			if (item === undefined) {
				break;
			}
			const children: RdbgTreeItem[] = [];
			let subArray: TraceLogItem[];
			let childLogs: TraceLogItem[];
			let childEnd: number;
			let childMinDepth = Infinity;
			let traceItem: TraceLogItem[];
			switch (true) {
				case item instanceof CallTraceLogItem:
				case item instanceof LineTraceLogItem:
					const idx = (item as TraceLogItem).index;
					subArray = this._traceLogs.slice(idx + 1);
					childEnd = subArray.length;
					// TODO: edge case
					for (let i = 0; i < subArray.length; i++) {
						if (subArray[i].depth <= this._traceLogs[idx].depth) {
							childEnd = i;
							break;
						}                   
					}
					childLogs = subArray.slice(0, childEnd);
					childMinDepth = this.getMinDepth(childLogs);
					traceItem = this.listTraceLogItems(childLogs, childMinDepth);
					push.apply(children, traceItem);
					// Do not await
					this.setParentChild(children, item);
					break;
				case item instanceof OmittedItem:
					const omitted = item as OmittedItem;
					subArray = this._traceLogs.slice(omitted.offset);
					childEnd = subArray.length;
					// TODO: edge case
					for (let i = 0; i < subArray.length; i++) {
						if (subArray[i].depth === omitted.depth) {
							childEnd = i;
							break;
						}
					}
					childLogs = subArray.slice(0, childEnd);
					childMinDepth = this.getMinDepth(childLogs);
					if (childLogs[0].depth > childMinDepth) {
						const o = new OmittedItem(omitted.index + 1, this._loadMoreOffset, childMinDepth);
						this._omittedItems.push(o);
						children.push(o);
					}
					traceItem = this.listTraceLogItems(childLogs, childMinDepth);
					push.apply(children, traceItem);
					// Do not await
					this.setParentChild(children, item);
					break;
				case item instanceof RootLogItem:
					if (this._loadMoreOffset !== 0) {
						children.push(new LoadMoreItem());
					}
					const logs = this._traceLogs.slice(this._loadMoreOffset);
					if (logs[0].depth > this._minDepth) {
						const omitted = new OmittedItem(0, this._loadMoreOffset, this._minDepth);
						this._omittedItems.push(omitted);
						children.push(omitted);
					}
					traceItem = this.listTraceLogItems(logs, this._minDepth);
					push.apply(children, traceItem);
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

	private hasChild(logs: TraceLog[], index: number) {
		const target = logs[index];
		return logs[index + 1] && logs[index + 1].depth > target.depth;
	}

	async getParent(element: RdbgTreeItem): Promise<RdbgTreeItem | null | undefined> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;

		return element.parent;
	}
}

class LineTraceLogItem extends TraceLogItem {
	constructor(
		log: TraceLog,
		idx: number,
		state?: vscode.TreeItemCollapsibleState,
	) {
		const opts: RdbgTreeItemOptions = { iconPath: locationIcon, collapsibleState: state };
		super(log.location.path, idx, log.depth, log.location, log.threadId, opts);
	}
}

const itemKey = 'item';
const indexKey = 'index';
class RdbgDecorationProvider implements vscode.FileDecorationProvider {
	constructor(
    private readonly _treeProvider: TraceLogsTreeProvider
	) {}
	provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
		if (!(uri.toString().startsWith('http://example.com'))) {
			return void 0;
		}
		const params = new URLSearchParams(uri.query);
		const itemKind = params.get(itemKey);
		switch (itemKind) {
			case 'trace':
				const index = params.get(indexKey);
				if (index === null) {
					return void 0;
				}
				const item = this._treeProvider.getTraceLogItem(parseInt(index));
				return {
					badge: item.threadId.toString(),
				};
			case 'load':
				return {
					color: new vscode.ThemeColor('textLink.foreground'),
				};
		}
	}
}

const arrowCircleRight = new vscode.ThemeIcon('arrow-circle-right');
const arrowCircleLeft = new vscode.ThemeIcon('arrow-circle-left');
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
  	const opts: RdbgTreeItemOptions = { iconPath: iconPath, description: log.location.path, collapsibleState: state, };
  	super(log.name || 'Unknown frame name', idx, log.depth, log.location, log.threadId, opts);
  	this.returnValue = log.returnValue;
	}
}

class RdbgInlayHintsProvider implements vscode.InlayHintsProvider {
	private readonly _singleSpace = ' ';
	private readonly _indent = this._singleSpace.repeat(5);
	private readonly _arrow = '#=>';
	constructor(
    private readonly _treeView: vscode.TreeView<RdbgTreeItem>
	) {}
	private _onDidChangeInlayHints: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	readonly onDidChangeInlayHints: vscode.Event<void> = this._onDidChangeInlayHints.event;
	provideInlayHints(document: vscode.TextDocument, range: vscode.Range, token: vscode.CancellationToken): vscode.ProviderResult<vscode.InlayHint[]> {
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
