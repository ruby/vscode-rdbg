import * as vscode from 'vscode';
import { LoadMoreItem, OmittedItem, RdbgTreeItem, RdbgTreeItemOptions, TraceLogItem } from './rdbgTreeItem';
import { TraceLogsArguments, TraceLogsResponse, TraceLog } from './traceLog';
import { sendDebugCommand } from './utils';

const locationIcon = new vscode.ThemeIcon('location');

export function registerTraceProvider(ctx: vscode.ExtensionContext) {
	const decorationProvider = new RdbgDecorationProvider();
	const treeProvider = new TraceLogsTreeProvider();
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
		vscode.commands.registerCommand('rdbg.trace.startTrace', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			try {
				await session.customRequest('rdbgInspectorTraceOn', {});
			} catch (err) { }
			vscode.commands.executeCommand('setContext', 'startTraceEnabled', false);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', true);
		}),

		vscode.commands.registerCommand('rdbg.trace.stopTrace', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			vscode.commands.executeCommand('setContext', 'startTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', false);
			try {
				await sendDebugCommand(session, 'trace off');
			} catch (err) { }
		}),

		vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
			switch (event.event) {
				case 'rdbgInspectorTraceLogsUpdated':
					treeProvider.refresh();
			}
		}),

		vscode.debug.onDidStartDebugSession(() => {
			vscode.commands.executeCommand('setContext', 'startTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', false);
		}),

		vscode.debug.onDidTerminateDebugSession(() => {
			treeProvider.cleanUp();
			vscode.commands.executeCommand('setContext', 'startTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', false);
		}),

		vscode.commands.registerCommand('rdbg.trace.openPrevLog', async () => {
			if (view.selection.length < 1) {
				const bottom = treeProvider.getBottomTraceLogItem();
				await view.reveal(bottom);
				return;
			}
			const log = treeProvider.getPrevLogItem(view.selection[0]);
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
				case e.selection[0] instanceof LoadMoreItem:
					treeProvider.refresh();
					break;
			}
		}),
	);
}

const initRowCount = 5;
const loadingRowCount = 3;

class TraceLogsTreeProvider implements vscode.TreeDataProvider<RdbgTreeItem> {
	public curSelectedIdx: number = 0;
	public totalCount = 0;
	private _traceLogs: TraceLogItem[] = [];
	private _loadMoreOffset: number = -1;
	private _minDepth = Infinity;
  private _omittedItems: OmittedItem[] = [];

  cleanUp() {
  	this._loadMoreOffset = -1;
  	this._minDepth = Infinity;
  }

  refresh() {
  	this._onDidChangeTreeData.fire();
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

  private getTraceLogItem(idx: number) {
  	return this._traceLogs[idx];
  }

  getPrevLogItem(selected: RdbgTreeItem) {
  	let idx: number;
  	let item: RdbgTreeItem;
  	switch (true) {
  		case selected instanceof LineTraceLogItem || selected instanceof CallTraceLogItem:
  			idx = (selected as TraceLogItem).index;
  			if (this.topItem(idx)) {
  				if (selected.parent === undefined) {
  					this.refresh();
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
  			if (selected.parent === undefined) {
  				this.refresh();
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

  private getOmittedItem(idx: number) {
  	return this._omittedItems[idx];
  }

	private _onDidChangeTreeData: vscode.EventEmitter<RdbgTreeItem | undefined | null | void> = new vscode.EventEmitter<RdbgTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<RdbgTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
	getTreeItem(element: RdbgTreeItem): RdbgTreeItem {
		return element;
	}

	async getChildren(element?: RdbgTreeItem): Promise<RdbgTreeItem[]> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return [];

		if (element) {
			const items: RdbgTreeItem[] = [];
			let subArray: TraceLogItem[];
			let childLogs: TraceLogItem[];
			let childEnd: number;
			let childMinDepth = Infinity;
			let children: TraceLogItem[];
			switch (true) {
				case element instanceof CallTraceLogItem:
				case element instanceof LineTraceLogItem:
					const idx = (element as LineTraceLogItem).index;
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
					children = this.listTraceLogItems(childLogs, childMinDepth);
					this.setParent(children, element);
					items.push(...children);
					break;
				case element instanceof OmittedItem:
					const omitted = element as OmittedItem;
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
						o.parent = omitted;
						items.push(o);
					}
					children = this.listTraceLogItems(childLogs, childMinDepth);
					this.setParent(children, element);
					items.push(...children);
					break;
			}
			return items;
		}
		if (this._traceLogs.length < 1) {
			let resp: TraceLogsResponse;
			try {
				const args: TraceLogsArguments = {
					type: 'dap',
				};
				resp = await session.customRequest('rdbgInspectorTraceLogs', args);
			} catch (error) {
				return [];
			}
			if (resp.logs && resp.logs.length < 1) {
				return [];
			}
			this._traceLogs = this.toTraceLogItems(resp.logs);
			let quotient = Math.floor(this._traceLogs.length / initRowCount);
			let remainder = this._traceLogs.length % initRowCount;
			if (quotient === 0) {
				quotient = 1;
				remainder = 0;
			}
			this._loadMoreOffset = initRowCount * (quotient - 1) + remainder;
			this._minDepth = this.getMinDepth(this._traceLogs);
		} else {
			this._loadMoreOffset -= loadingRowCount;
			if (this._loadMoreOffset < 0) {
				this._loadMoreOffset = 0;
			}
		}
		this._omittedItems = [];
		const items: RdbgTreeItem[] = [];
		if (this._loadMoreOffset !== 0) {
			items.push(new LoadMoreItem());
		}
		const logs = this._traceLogs.slice(this._loadMoreOffset);
		if (logs[0].depth > this._minDepth) {
			const omitted = new OmittedItem(0, this._loadMoreOffset, this._minDepth);
			this._omittedItems.push(omitted);
			items.push(omitted);
		}
		const root = this.listTraceLogItems(logs, this._minDepth);
		items.push(...root);
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

	private getMinDepth(logs: TraceLogItem[]) {
		let min = Infinity;
		for (const log of logs) {
			if (log.depth < min) {
				min = log.depth;
			}
		}
		return min;
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

	private setParent(children: TraceLogItem[], parent: RdbgTreeItem) {
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
		super(log.location.path, idx, log.depth, log.location, opts);
	}
}

class RdbgDecorationProvider implements vscode.FileDecorationProvider {
	provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
		if (uri.toString() !== vscode.Uri.parse('http://example.com').toString()) {
			return void 0;
		}
		return {
			color: new vscode.ThemeColor('textLink.foreground')
		};
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
  	super(log.name || 'Unknown frame name', idx, log.depth, log.location, opts);
  	this.returnValue = log.returnValue;
  }
}

class RdbgInlayHintsProvider implements vscode.InlayHintsProvider {
  private readonly _singleSpace = ' ';
  private readonly _indent = this._singleSpace.repeat(5)
  private readonly _arrow = '=>';
  constructor(
    private readonly _treeView: vscode.TreeView<RdbgTreeItem>
  ) {}
  private _onDidChangeInlayHints: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	readonly onDidChangeInlayHints: vscode.Event<void> = this._onDidChangeInlayHints.event;
	provideInlayHints(document: vscode.TextDocument, range: vscode.Range, token: vscode.CancellationToken): vscode.ProviderResult<vscode.InlayHint[]> {
		const hints: vscode.InlayHint[] = []
		if (this._treeView.selection.length < 1) {
			return hints;
		}
		const selection = this._treeView.selection[0];
		if (selection instanceof CallTraceLogItem && selection.returnValue !== undefined) {
			const line = selection.location.line - 1
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
