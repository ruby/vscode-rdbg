import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import { Location, TraceLogChildrenResponse, TraceLogParentArguments, TraceLogParentResponse, TraceLogRootArguments, TraceLogRootResponse, TraceLogsEvent } from './traceLog';
import { RdbgTreeItem, PagenationItem, RdbgTreeItemOptions, TraceLogItem } from './rdbgTreeItem';
import { getPageNationItems } from './utils';

const arrowCircleRight = new vscode.ThemeIcon('arrow-circle-right');
const arrowCircleLeft = new vscode.ThemeIcon('arrow-circle-left');

export function registerCallTraceProvider(ctx: vscode.ExtensionContext) {
	const treeProvider = new TraceLogsTreeProvider();
	const view = vscode.window.createTreeView('rdbg.trace.call', { treeDataProvider: treeProvider });

	ctx.subscriptions.push(
		vscode.commands.registerCommand('rdbg.trace.call.startTrace', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			try {
				await sendDebugCommand(session, 'trace call');
			} catch (err) { }

			vscode.commands.executeCommand('setContext', 'startCallTraceEnabled', false);
			vscode.commands.executeCommand('setContext', 'stopCallTraceEnabled', true);
		}),

		vscode.commands.registerCommand('rdbg.trace.call.stopTrace', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			vscode.commands.executeCommand('setContext', 'startCallTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopCallTraceEnabled', false);
			try {
				await sendDebugCommand(session, 'trace off');
			} catch (err) { }
		}),

		vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
			switch (event.event) {
				case 'rdbgInspectorTraceLogsUpdated':
					const evt = event as TraceLogsEvent;
					if (evt.body.call) {
						treeProvider.totalCount = evt.body.call.size;
						treeProvider.curSelectedIdx = event.body.line.size;
						treeProvider.refresh();
					}
			}
		}),

		vscode.debug.onDidStartDebugSession(() => {
			vscode.commands.executeCommand('setContext', 'startCallTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopCallTraceEnabled', false);
		}),

		vscode.debug.onDidTerminateDebugSession(() => {
			treeProvider.refresh();
			vscode.commands.executeCommand('setContext', 'startCallTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopCallTraceEnabled', false);
		}),

		vscode.commands.registerCommand('rdbg.trace.call.openPrevLog', async () => {
			if (view.selection.length > 0 && view.selection[0] instanceof CallTraceLogItem) {
				treeProvider.curSelectedIdx = (view.selection[0] as CallTraceLogItem).index;
			}
			treeProvider.curSelectedIdx -= 1;
			const item = new CallTraceLogItem('', treeProvider.curSelectedIdx, { name: '', path: '', line: 0 });
			await view.reveal(item, { select: true, expand: 3 });
			const selection = view.selection[0] as CallTraceLogItem;
			const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(selection.location.line - 1, 0, selection.location.line - 1, 0), preserveFocus: true };
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(selection.location.path), opts);
		}),

		vscode.commands.registerCommand('rdbg.trace.call.openNextLog', async () => {
			if (view.selection.length > 0 && view.selection[0] instanceof CallTraceLogItem) {
				treeProvider.curSelectedIdx = (view.selection[0] as CallTraceLogItem).index;
			}
			treeProvider.curSelectedIdx += 1;
			const item = new CallTraceLogItem('', treeProvider.curSelectedIdx, { name: '', path: '', line: 0 });
			await view.reveal(item, { select: true, expand: true });
			const selection = view.selection[0] as CallTraceLogItem;
			const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(selection.location.line - 1, 0, selection.location.line - 1, 0), preserveFocus: true };
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(selection.location.path), opts);
		}),

		vscode.commands.registerCommand('rdbg.trace.call.openTargetLog', async (loc: Location) => {
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
				case element instanceof CallTraceLogItem:
					const pageNum = Math.floor((element as CallTraceLogItem).index / pageSize + 1);
					const offset = (pageNum - 1) * pageSize;
					let childResp: TraceLogChildrenResponse;
					try {
						const args: TraceLogParentArguments = {
							index: (element as CallTraceLogItem).index,
							type: 'line',
							offset,
							pageSize
						};
						childResp = await session.customRequest('rdbgInspectorTraceLogChildren', args);
					} catch (error) {
						return [];
					}
					return childResp.logs.map((log) => {
						if (log.name === null) throw new Error('Invalid');

						const iconPath = this.getIconPath(log.name);
						const item = new CallTraceLogItem(
							log.name.slice(1).trim(),
							log.index,
							log.location,
							{ iconPath: iconPath, description: log.location.name }
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
							type: 'call'
						};
						rootResp = await session.customRequest('rdbgInspectorTraceLogRoot', args);
					} catch (error) {
						return [];
					}
					return rootResp.logs.map((log) => {
						if (log.name === null) throw new Error('Invalid');

						const iconPath = this.getIconPath(log.name);
						const item = new CallTraceLogItem(
							log.name.slice(1).trim(),
							log.index,
							log.location,
							{ iconPath: iconPath, description: log.location.name }
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

	async getParent(element: CallTraceLogItem): Promise<RdbgTreeItem | null | undefined> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;

		const pageNum = Math.floor(element.index / pageSize + 1);
		const offset = (pageNum - 1) * pageSize;
		let resp: TraceLogParentResponse;
		try {
			const args: TraceLogParentArguments = {
				index: element.index,
				type: 'call',
				offset,
				pageSize,
			};
			resp = await session.customRequest('rdbgInspectorTraceLogParent', args);
		} catch (error) {
			return void 0;
		}
		if (resp.log === null || resp.log.name === null) return this.pages[pageNum - 1];

		const iconPath = this.getIconPath(resp.log.name);
		const item = new CallTraceLogItem(
			resp.log.name.slice(1).trim(),
			resp.log.index,
			resp.log.location,
			{ iconPath: iconPath, description: resp.log.location.name }
		);
		return item;
	}

	private getIconPath(name: string) {
		let iconPath = undefined;
		if (name.slice(0, 1) === '>') {
			iconPath = arrowCircleRight;
		} else {
			iconPath = arrowCircleLeft;
		}
		return iconPath;
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
