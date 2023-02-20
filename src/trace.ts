import * as vscode from 'vscode';
import { LoadMoreItem, OmittedItem, RdbgTreeItem, RdbgTreeItemOptions, TraceLogItem } from './rdbgTreeItem';
import { TraceLogsArguments, TraceLogsResponse, TraceLog } from './traceLog';
import { sendDebugCommand } from './utils';

const locationIcon = new vscode.ThemeIcon('location');

export function registerTraceProvider(ctx: vscode.ExtensionContext) {
	const decorationProvider = new RdbgDecorationProvider();
	const treeProvider = new TraceLogsTreeProvider();
	const view = vscode.window.createTreeView('rdbg.trace', { treeDataProvider: treeProvider });

	ctx.subscriptions.push(
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

		// vscode.commands.registerCommand('rdbg.trace.openPrevLog', async () => {
		// 	if (view.selection.length > 0 && view.selection[0] instanceof LineTraceLogItem) {
		// 		treeProvider.curSelectedIdx = (view.selection[0] as LineTraceLogItem).index;
		// 	}
		// 	treeProvider.curSelectedIdx -= 1;
		// 	const item = new LineTraceLogItem('', treeProvider.curSelectedIdx, { path: '', line: 0 });
		// 	await view.reveal(item, { select: true, expand: 3 });
		// 	const selection = view.selection[0] as LineTraceLogItem;
		// 	const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(selection.location.line - 1, 0, selection.location.line - 1, 0), preserveFocus: true };
		// 	await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(selection.location.path), opts);
		// }),

		// vscode.commands.registerCommand('rdbg.trace.openNextLog', async () => {
		//   if (view.selection.length > 1 && (view.selection[0] instanceof LineTraceLogItem || view.selection[0] instanceof CallTraceLogItem)) {
		//     const log = treeProvider.getTraceLog(view.selection[0].index);
		//     const item = new LineTraceLogItem(log);
		//     await view.reveal(item, { select: true, expand: true });
		//   }
		// }),

		view.onDidChangeSelection(async (e) => {
			if (e.selection.length > 0 && (e.selection[0] instanceof LineTraceLogItem || e.selection[0] instanceof CallTraceLogItem)) {
				const opts: vscode.TextDocumentShowOptions = {
					selection: new vscode.Range(e.selection[0].location.line - 1, 0, e.selection[0].location.line - 1, 0),
					preserveFocus: true 
				};
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(e.selection[0].location.path), opts);
			}
		}),

		vscode.commands.registerCommand('rdbg.trace.line.LoadMoreLogs', () => {
			treeProvider.refresh();
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

	cleanUp() {
		this._loadMoreOffset = -1;
		this._minDepth = Infinity;
	}

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	getTraceLog(idx: number) {
		if (this._traceLogs[idx] !== undefined) {
			this.curSelectedIdx = idx;
		}
		return this._traceLogs[this.curSelectedIdx];
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
					items.push(...this.getRoot(childLogs, childMinDepth));
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
						items.push(new OmittedItem(this._loadMoreOffset, childMinDepth));
					}
					items.push(...this.getRoot(childLogs, childMinDepth));
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
		const items: RdbgTreeItem[] = [];
		if (this._loadMoreOffset !== 0) {
			items.push(new LoadMoreItem());
		}
		const logs = this._traceLogs.slice(this._loadMoreOffset);
		if (logs[0].depth > this._minDepth) {
			items.push(new OmittedItem(this._loadMoreOffset, this._minDepth));
		}
		const root = this.getRoot(logs, this._minDepth);
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

	// 	async getParent(element: RdbgTreeItem): Promise<RdbgTreeItem | null | undefined> {
	// 		const session = vscode.debug.activeDebugSession;
	// 		if (session === undefined) return void 0;

	// 		if (!(element instanceof LineTraceLogItem)) return void 0;

	// 		const pageNum = Math.floor(element.index / pageSize + 1);
	// 		const offset = (pageNum - 1) * pageSize;
	// 		let resp: TraceLogParentResponse;
	// 		try {
	// 			const args: TraceLogParentArguments = {
	// 				index: element.index,
	// 				type: 'line',
	// 				offset,
	// 				pageSize,
	// 			};
	// 			resp = await session.customRequest('rdbgInspectorTraceLogParent', args);
	// 		} catch (error) {
	// 			return void 0;
	// 		}
	// 		if (resp.log === null) return this.pages[pageNum - 1];

	// 		const item = new LineTraceLogItem(
	// 			resp.log.location.name,
	// 			resp.log.index,
	// 			resp.log.location,
	// 			{ iconPath: locationIcon }
	// 		);
	// 		return item;
	// 	}
	private getRoot(logs: TraceLogItem[], depth: number) {
		const root: TraceLogItem[] = [];
		for (const log of logs) {
			if (log.depth === depth) {
				root.push(log);
			}
		}
		return root;
	}

  private hasChild(logs: TraceLog[], index: number) {
    const target = logs[index];
    return logs[index + 1] && logs[index + 1].depth > target.depth;
  }
}

// function getRoot(logs: TraceLog[], minDepth: number) {
// 	const root: TraceLogItem[] = [];
// 	logs.forEach((log, idx) => {
// 		if (log.depth === minDepth) {
// 			let state = vscode.TreeItemCollapsibleState.None;
// 			if (hasChild(logs, idx)) {
// 				state = vscode.TreeItemCollapsibleState.Expanded;
// 			}
// 			let item: TraceLogItem;
// 			if (log.name) {
// 				item = new CallTraceLogItem(log, state);
// 			} else {
// 				item = new LineTraceLogItem(log, state);
// 			}
// 			root.push(item);
// 		}
// 	});
// 	return root;
// }

// function hasChild(logs: TraceLog[], index: number) {
// 	const target = logs[index];
// 	return logs[index + 1] && logs[index + 1].depth > target.depth;
// }

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
	constructor(
		log: TraceLog,
		idx: number,
		state?: vscode.TreeItemCollapsibleState,
	) {
		let iconPath: vscode.ThemeIcon;
		if (log.returnValue) {
			iconPath = arrowCircleRight;
		} else {
			iconPath = arrowCircleLeft;
		}
		const opts: RdbgTreeItemOptions = { iconPath: iconPath, description: log.location.path, collapsibleState: state, };
		super(log.name || 'Unknown frame name', idx, log.depth, log.location, opts);
	}
}
