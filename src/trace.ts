import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import { LoadMoreItem, OmittedItem, PagenationItem, RdbgTreeItem, RdbgTreeItemOptions, TraceLogItem } from './rdbgTreeItem';
import { TraceLogsEvent, TraceLogChildrenResponse, TraceLogParentResponse, TraceLogRootResponse, Location, TraceLogParentArguments, TraceLogChildrenArguments, TraceLogRootArguments, TraceLogsArguments, TraceLogsResponse, TraceLog, TraceLog2 } from './traceLog';
import { getPageNationItems, sendDebugCommand } from './utils';

const locationIcon = new vscode.ThemeIcon('location');

export function registerTraceProvider(ctx: vscode.ExtensionContext) {
	const decorationProvider = new RdbgDecorationProvider();
	const treeProvider = new LineTraceLogsTreeProvider();
	const view = vscode.window.createTreeView('rdbg.trace.line', { treeDataProvider: treeProvider });

	ctx.subscriptions.push(
		vscode.window.registerFileDecorationProvider(decorationProvider),
		vscode.commands.registerCommand('rdbg.trace.line.startTrace', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			try {
				await session.customRequest('rdbgInspectorTraceOn', {});
			} catch (err) { }

			vscode.commands.executeCommand('setContext', 'startLineTraceEnabled', false);
			vscode.commands.executeCommand('setContext', 'stopLineTraceEnabled', true);
		}),

		vscode.commands.registerCommand('rdbg.trace.line.stopTrace', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			vscode.commands.executeCommand('setContext', 'startLineTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopLineTraceEnabled', false);
			try {
				await sendDebugCommand(session, 'trace off');
			} catch (err) { }
		}),

		vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
			switch (event.event) {
				case 'rdbgInspectorTraceLogsUpdated':
					// const evt = event as TraceLogsEvent;
					// if (evt.body.dap) {
					// treeProvider.totalCount = evt.body.dap.size;
					// treeProvider.curSelectedIdx = event.body.dap.size;
					treeProvider.refresh();
				// }
			}
		}),

		vscode.debug.onDidStartDebugSession(() => {
			vscode.commands.executeCommand('setContext', 'startLineTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopLineTraceEnabled', false);
		}),

		vscode.debug.onDidTerminateDebugSession(() => {
			treeProvider.refresh();
			vscode.commands.executeCommand('setContext', 'startLineTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopLineTraceEnabled', false);
		}),

		vscode.commands.registerCommand('rdbg.trace.line.openPrevLog', async () => {
			if (view.selection.length > 0 && view.selection[0] instanceof LineTraceLogItem) {
				treeProvider.curSelectedIdx = (view.selection[0] as LineTraceLogItem).index;
			}
			treeProvider.curSelectedIdx -= 1;
			const item = new LineTraceLogItem('', treeProvider.curSelectedIdx, { name: '', path: '', line: 0 });
			await view.reveal(item, { select: true, expand: 3 });
			const selection = view.selection[0] as LineTraceLogItem;
			const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(selection.location.line - 1, 0, selection.location.line - 1, 0), preserveFocus: true };
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(selection.location.path), opts);
		}),

		vscode.commands.registerCommand('rdbg.trace.line.openNextLog', async () => {
			if (view.selection.length > 0 && view.selection[0] instanceof LineTraceLogItem) {
				treeProvider.curSelectedIdx = (view.selection[0] as LineTraceLogItem).index;
			}
			treeProvider.curSelectedIdx += 1;
			const item = new LineTraceLogItem('', treeProvider.curSelectedIdx, { name: '', path: '', line: 0 });
			await view.reveal(item, { select: true, expand: true });
			const selection = view.selection[0] as LineTraceLogItem;
			const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(selection.location.line - 1, 0, selection.location.line - 1, 0), preserveFocus: true };
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(selection.location.path), opts);
		}),

		vscode.commands.registerCommand('rdbg.trace.line.openTargetLog', async (loc: Location) => {
			const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(loc.line - 1, 0, loc.line - 1, 0), preserveFocus: true };
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(loc.path), opts);
		}),

		vscode.commands.registerCommand('rdbg.trace.line.LoadMoreLogs', () => {
			treeProvider.refresh();
		}),
	);
}

const initRowCount = 5;
const loadingRowCount = 3;

class LineTraceLogsTreeProvider implements vscode.TreeDataProvider<RdbgTreeItem> {
	public curSelectedIdx: number = 0;
	public totalCount = 0;
	private _traceLogs: TraceLog2[] = [];
	// TODO: how to reset these value
	private _loadMoreOffset: number = -1;
	private _minDepth = Infinity;

	refresh() {
		this._onDidChangeTreeData.fire();
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
			let subArray: TraceLog2[];
			let childLogs: TraceLog2[];
			let childEnd = -1;
			let childMinDepth = Infinity;
			switch (true) {
				case element instanceof CallTraceLogItem:
				case element instanceof LineTraceLogItem:
					const idx = (element as LineTraceLogItem).index;
					subArray = this._traceLogs.slice(idx + 1);
					// TODO: edge case
					for (let i = 0; i < subArray.length; i++) {
						if (subArray[i].depth <= this._traceLogs[idx].depth) {
							childEnd = i;
							break;
						}
						if (subArray[i].depth < childMinDepth) {
							childMinDepth = subArray[i].depth;
						}
					}
					childLogs = subArray.slice(0, childEnd);
					items.push(...getRoot(childLogs, childMinDepth));
					break;
				case element instanceof OmittedItem:
					const omitted = element as OmittedItem;
					subArray = this._traceLogs.slice(omitted.offset);
					// TODO: edge case
					for (let i = 0; i < subArray.length; i++) {
						if (subArray[i].depth === omitted.depth) {
							childEnd = i;
							break;
						}
						if (subArray[i].depth < childMinDepth) {
							childMinDepth = subArray[i].depth;
						}
					}
					childLogs = subArray.slice(0, childEnd);
					if (childLogs[0].depth > childMinDepth) {
						items.push(new OmittedItem(this._loadMoreOffset, childMinDepth));
					}
					items.push(...getRoot(childLogs, childMinDepth));
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
			this._traceLogs = resp.logs;
			let quotient = Math.floor(this._traceLogs.length / initRowCount);
			let remainder = this._traceLogs.length % initRowCount;
			if (quotient === 0) {
				quotient = 1;
				remainder = 0;
			}
			this._loadMoreOffset = initRowCount * (quotient - 1) + remainder;
			this._traceLogs.forEach((log, idx) => {
				log.index = idx;
				if (log.depth < this._minDepth) {
					this._minDepth = log.depth;
				}
			});
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
		const root = getRoot(logs, this._minDepth);
		items.push(...root);
		return items;
	}

	// async getParent(element: RdbgTreeItem): Promise<RdbgTreeItem | null | undefined> {
	// 	const session = vscode.debug.activeDebugSession;
	// 	if (session === undefined) return void 0;

	// 	if (!(element instanceof LineTraceLogItem)) return void 0;

	// 	const pageNum = Math.floor(element.index / pageSize + 1);
	// 	const offset = (pageNum - 1) * pageSize;
	// 	let resp: TraceLogParentResponse;
	// 	try {
	// 		const args: TraceLogParentArguments = {
	// 			index: element.index,
	// 			type: 'line',
	// 			offset,
	// 			pageSize,
	// 		};
	// 		resp = await session.customRequest('rdbgInspectorTraceLogParent', args);
	// 	} catch (error) {
	// 		return void 0;
	// 	}
	// 	if (resp.log === null) return this.pages[pageNum - 1];

	// 	const item = new LineTraceLogItem(
	// 		resp.log.location.name,
	// 		resp.log.index,
	// 		resp.log.location,
	// 		{ iconPath: locationIcon }
	// 	);
	// 	return item;
	// }
}

function getRoot(logs: TraceLog2[], minDepth: number) {
	const root: TraceLogItem[] = [];
	logs.forEach((log, idx) => {
		if (log.depth === minDepth) {
			let state = vscode.TreeItemCollapsibleState.None;
			if (hasChild(logs, idx)) {
				state = vscode.TreeItemCollapsibleState.Expanded;
			}
			let item: TraceLogItem;
			if (log.name) {
				const iconPath = getIconPath(log.name);
				item = new CallTraceLogItem(
					log.name.slice(1).trim(),
					log.index,
					log.location,
					{ iconPath: iconPath, description: log.location.name, collapsibleState: state }
				);
			} else {
				item = new LineTraceLogItem(
					log.location.name,
					log.index,
					log.location,
					{ iconPath: locationIcon, collapsibleState: state }
				);
			}
			root.push(item);
		}
	});
	return root;
}

function hasChild(logs: TraceLog2[], index: number) {
	const target = logs[index];
	return logs[index + 1] && logs[index + 1].depth > target.depth;
}

class LineTraceLogItem extends TraceLogItem {
	constructor(
		label: string,
		index: number,
		location: Location,
		opts: RdbgTreeItemOptions = {},
	) {
		super(label, index, location, opts);
		this.command = { command: 'rdbg.trace.line.openTargetLog', title: 'rdbg.trace.line.openTargetLog', arguments: [location] };
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

class CallTraceLogItem extends TraceLogItem {
	constructor(
		label: string,
		index: number,
		location: Location,
		opts: RdbgTreeItemOptions = {},
	) {
		super(label, index, location, opts);
		this.command = { command: 'rdbg.trace.call.openTargetLog', title: 'rdbg.trace.call.openTargetLog', arguments: [location] };
	}
}

const arrowCircleRight = new vscode.ThemeIcon('arrow-circle-right');
const arrowCircleLeft = new vscode.ThemeIcon('arrow-circle-left');

function getIconPath(name: string) {
	let iconPath = undefined;
	if (name.slice(0, 1) === '>') {
		iconPath = arrowCircleRight;
	} else {
		iconPath = arrowCircleLeft;
	}
	return iconPath;
}
