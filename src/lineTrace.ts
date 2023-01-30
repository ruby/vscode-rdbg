import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import { PagenationItem, RdbgTreeItem, RdbgTreeItemOptions, TraceLogItem } from './rdbgTreeItem';
import { TraceLogsEvent, TraceLogChildResponse, TraceLogParentResponse, TraceLogRootResponse, Location, TraceLogParentArguments, TraceLogChildrenArguments, TraceLogRootArguments } from './traceLog';
import { getPageNationItems } from './utils';

const locationIcon = new vscode.ThemeIcon('location');

export function registerLineTraceProvider(ctx: vscode.ExtensionContext) {
	const treeProvider = new TraceLogsTreeProvider();
	const view = vscode.window.createTreeView('rdbg.trace.line', { treeDataProvider: treeProvider });

	ctx.subscriptions.push(
		vscode.commands.registerCommand('rdbg.trace.line.startTrace', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			try {
				await sendDebugCommand(session, 'trace line');
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
					const evt = event as TraceLogsEvent;
					if (evt.body.line) {
						treeProvider.totalCount = evt.body.line.size;
						treeProvider.curSelectedIdx = event.body.line.size;
						treeProvider.refresh();
					}
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
	);
}

async function sendDebugCommand(session: vscode.DebugSession, cmd: string) {
	const args: DebugProtocol.EvaluateArguments = {
		expression: `,${cmd}`,
		context: 'repl'
	};
	try {
		await session.customRequest('evaluate', args);
	} catch (err) { }
	try {
		await session.customRequest('completions');
	} catch (err) { }
};

const pageSize = 5;

class TraceLogsTreeProvider implements vscode.TreeDataProvider<RdbgTreeItem> {
	public curSelectedIdx: number = 0;
	public totalCount = 0;
	private pages: PagenationItem[] = [];

	refresh() {
		this.pages = [];
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
			switch (true) {
				case element instanceof LineTraceLogItem:
					const pageNum = Math.floor((element as LineTraceLogItem).index / pageSize + 1);
					const offset = (pageNum - 1) * pageSize;
					let childResp: TraceLogChildResponse;
					try {
						const args: TraceLogChildrenArguments = {
							index: (element as LineTraceLogItem).index,
							type: 'line',
							offset,
							pageSize
						};
						childResp = await session.customRequest('rdbgInspectorTraceLogChildren', args);
					} catch (error) {
						return [];
					}
					return childResp.logs.map((log) => {
						const item = new LineTraceLogItem(
							log.location.name,
							log.index,
							log.location,
							{ iconPath: locationIcon }
						);
						if (log.hasChild !== undefined) {
							if (element.isLastPage) {
								item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
								item.isLastPage = true;
							} else {
								item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
							}
						}
						return item;
					});
				case element instanceof PagenationItem:
					const page = element as PagenationItem;
					let rootResp: TraceLogRootResponse;
					try {
						const args: TraceLogRootArguments = {
							offset: page.offset,
							pageSize: pageSize,
							type: 'line'
						};
						rootResp = await session.customRequest('rdbgInspectorTraceLogRoot', args);
					} catch (error) {
						return [];
					}
					return rootResp.logs.map((log) => {
						const item = new LineTraceLogItem(
							log.location.name,
							log.index,
							log.location,
							{ iconPath: locationIcon }
						);
						if (log.hasChild !== undefined) {
							if (element.isLastPage) {
								item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
								item.isLastPage = true;
							} else {
								item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
							}
						}
						return item;
					});
				default:
					return [];
			}
		}
		this.pages = getPageNationItems(pageSize, this.curSelectedIdx);
		return this.pages;
	}

	async getParent(element: RdbgTreeItem): Promise<RdbgTreeItem | null | undefined> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;

		if (!(element instanceof LineTraceLogItem)) return void 0;

		const pageNum = Math.floor(element.index / pageSize + 1);
		const offset = (pageNum - 1) * pageSize;
		let resp: TraceLogParentResponse;
		try {
			const args: TraceLogParentArguments = {
				index: element.index,
				type: 'line',
				offset,
				pageSize,
			};
			resp = await session.customRequest('rdbgInspectorTraceLogParent', args);
		} catch (error) {
			return void 0;
		}
		if (resp.log === null) return this.pages[pageNum - 1];

		const item = new LineTraceLogItem(
			resp.log.location.name,
			resp.log.index,
			resp.log.location,
			{ iconPath: locationIcon }
		);
		return item;
	}
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
