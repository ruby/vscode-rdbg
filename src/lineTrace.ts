import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';

const arrowCircleRight = new vscode.ThemeIcon('arrow-circle-right');
const arrowCircleLeft = new vscode.ThemeIcon('arrow-circle-left');
const locationIcon = new vscode.ThemeIcon('location');

export function registerLineTraceProvider(ctx: vscode.ExtensionContext) {
	const treeProvider = new TraceLogsTreeProvider();
	const view = vscode.window.createTreeView('rdbg.trace.line', { treeDataProvider: treeProvider });

	ctx.subscriptions.push(
		vscode.commands.registerCommand('rdbg.trace.line.startTrace', async (hoge) => {
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
					treeProvider.threadId = event.body.threadId;
					treeProvider.refresh();
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
			if (view.selection.length > 0 && view.selection[0].type === 'log') {
				treeProvider.curIndex = (view.selection[0] as TraceLogItem).index;
			}
			treeProvider.curIndex -= 1;
			const item = await treeProvider.getSpecificLog();
			if (item) {
				await view.reveal(item, { select: true, expand: true });
				const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(item.location.line - 1, 0, item.location.line - 1, 0), preserveFocus: true };
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.location.path), opts);
			}
		}),

		vscode.commands.registerCommand('rdbg.trace.line.openNextLog', async () => {
			if (view.selection.length > 0 && view.selection[0].type === 'log') {
				treeProvider.curIndex = (view.selection[0] as TraceLogItem).index;
			}
			treeProvider.curIndex += 1;
			const item = await treeProvider.getSpecificLog();
			if (item) {
				await view.reveal(item, { select: true, expand: true });
				const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(item.location.line - 1, 0, item.location.line - 1, 0), preserveFocus: true };
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.location.path), opts);
			}
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

const pageSize = 100;

class TraceLogsTreeProvider implements vscode.TreeDataProvider<RdbgTreeItem> {
	public threadId: number = 0;
	public curIndex: number = 0;

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	private _onDidChangeTreeData: vscode.EventEmitter<RdbgTreeItem | undefined | null | void> = new vscode.EventEmitter<RdbgTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<RdbgTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
	getTreeItem(element: RdbgTreeItem): RdbgTreeItem {
		return element;
	}

	async getSpecificLog() {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;

		let resp: TraceLogParentResponse;
		try {
			resp = await session.customRequest('rdbgInspectorTraceLog', {
				id: this.curIndex,
				type: 'line'
			});
		} catch (error) {
			return void 0;
		}
		if (resp.log === null) return void 0;

		const item = new TraceLogItem(resp.log.location.name, resp.log.location);
		item.id = resp.log.index.toString();
		item.index = resp.log.index;
		return item;
	}

	async getChildren(element?: RdbgTreeItem): Promise<RdbgTreeItem[]> {
		console.log('called');
		console.log(element);
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return [];

		if (element) {
			switch (element.type) {
				case 'log':
					let resp: TraceLogChildResponse;
					try {
						resp = await session.customRequest('rdbgInspectorTraceLogChildren', {
							id: (element as TraceLogItem).index,
							type: 'line'
						});
					} catch (error) {
						return [];
					}
					return resp.logs.map((log) => {
						const item = new TraceLogItem(log.location.name, log.location);
						if (log.hasChild !== undefined) {
							if (element.shouldExpand) {
								item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
								item.shouldExpand = true;
							} else {
								item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
							}
						} else {
							item.collapsibleState = vscode.TreeItemCollapsibleState.None;
						}
						item.index = log.index;
						item.iconPath = locationIcon;
						item.id = log.index.toString();
						return item;
					});
				case 'page':
					const page = element as PagenationItem;
					let resp2: TraceLogChildResponse;
					try {
						resp2 = await session.customRequest('rdbgInspectorTraceLogRoot', {
							offset: page.offset,
							pageSize: pageSize,
							type: 'line'
						});
					} catch (error) {
						return [];
					}
					const a= resp2.logs.map((log) => {
						const item = new TraceLogItem(log.location.name, log.location);
						if (log.hasChild !== undefined) {
							if (element.shouldExpand) {
								item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
								item.shouldExpand = true;
							} else {
								item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
							}
						} else {
							item.collapsibleState = vscode.TreeItemCollapsibleState.None;
						}
						item.index = log.index;
						item.iconPath = locationIcon;
						item.id = log.index.toString();
						return item;
					});
					a[a.length-1].collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
					return a;
				default:
					return [];
			}
		} else {
			let resp: TraceLogsResponse;
			try {
				resp = await session.customRequest('rdbgInspectorTraceLogs', {
					threadId: this.threadId
				});
			} catch (err) { return []; }
			if (resp.line) {
				this.curIndex = resp.line.size;
				let i = 1;
				// const pages = [];
				while (true) {
					const page = new PagenationItem(`Page ${i}`);
					page.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
					page.offset = (i - 1) * pageSize;
					this.pages.push(page);
					if (i * pageSize > resp.line.size) {
						break;
					}
					i++;
				}
				// pages[pages.length - 1].shouldExpand = true;
				// pages[pages.length - 1].collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
				return this.pages;
			}
			return [];
		}
	}

	private pages: PagenationItem[] = [];

	async getParent(element: TraceLogItem): Promise<RdbgTreeItem | null | undefined> {
		console.log('called2');
		console.log(element);
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;

		let resp: TraceLogParentResponse;
		try {
			resp = await session.customRequest('rdbgInspectorTraceLogParent', {
				id: element.index,
				type: 'line'
			});
		} catch (error) {
			return void 0;
		}
		if (resp.log === null) return this.pages[this.pages.length-1];

		const item = new TraceLogItem(resp.log.location.name, resp.log.location);
		item.index = resp.log.index;
		item.iconPath = locationIcon;
		item.id = resp.log.index.toString();
		return item;
	}
}

interface Location {
	name: string;
	path: string;
	line: number;
}

interface TraceLogsResponse {
	call?: {
		size: number;
		logs: TraceLog[]
	};
	line?: {
		size: number;
		logs: TraceLog[]
	};
	exception?: TraceLog[];
	object?: TraceLog[];
}

interface TraceLogChildResponse {
	logs: TraceLog[];
}

interface TraceLogParentResponse {
	log: TraceLog | null;
}

interface TraceLog {
	hasChild?: boolean;
	location: Location;
	name: string | null;
	index: number;
}

class RdbgTreeItem extends vscode.TreeItem {
  // isLastPage = false; 
	public shouldExpand = false;
	constructor(
		public readonly type: "page" | "log",
		public readonly label: string,
		public collapsibleState?: vscode.TreeItemCollapsibleState,
	) {
		super(label, collapsibleState);
	}
}

class PagenationItem extends RdbgTreeItem {
	public offset = -1;
	constructor(
		public readonly label: string,
		public collapsibleState?: vscode.TreeItemCollapsibleState,
	) {
		super('page', label, collapsibleState);
	}
}

class TraceLogItem extends RdbgTreeItem {
	public index: number = 0;
	constructor(
		public readonly label: string,
		public readonly location: Location,
		public collapsibleState?: vscode.TreeItemCollapsibleState,
	) {
		super('log', label, collapsibleState);
		this.command = { command: 'rdbg.trace.line.openTargetLog', title: 'open log', arguments: [location] };
	}
}
