import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';

const arrowCircleRight = new vscode.ThemeIcon('arrow-circle-right');
const arrowCircleLeft = new vscode.ThemeIcon('arrow-circle-left');

export function registerExceptionTraceProvider(ctx: vscode.ExtensionContext) {
	const treeProvider = new TraceLogsTreeProvider();
	const view = vscode.window.createTreeView('rdbg.trace.exception', { treeDataProvider: treeProvider });

	ctx.subscriptions.push(
		vscode.commands.registerCommand('rdbg.trace.exception.startTrace', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			try {
				await sendDebugCommand(session, 'trace exception');
			} catch (err) { }

			vscode.commands.executeCommand('setContext', 'startExceptionTraceEnabled', false);
			vscode.commands.executeCommand('setContext', 'stopExceptionTraceEnabled', true);
		}),

		vscode.commands.registerCommand('rdbg.trace.exception.stopTrace', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			vscode.commands.executeCommand('setContext', 'startExceptionTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopExceptionTraceEnabled', false);
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
			vscode.commands.executeCommand('setContext', 'startExceptionTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopExceptionTraceEnabled', false);
		}),

		vscode.debug.onDidTerminateDebugSession(() => {
			treeProvider.refresh();
			vscode.commands.executeCommand('setContext', 'startExceptionTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopExceptionTraceEnabled', false);
		}),

		vscode.commands.registerCommand('rdbg.trace.exception.openPrevLog', async () => {
			if (view.selection.length > 0) {
				treeProvider.curIndex = view.selection[0].index;
				treeProvider.curIndex -= 1;
			}
			const item = await treeProvider.getSpecificLog();
			if (item) {
				await view.reveal(item, { select: true, expand: true });
				const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(item.location.line - 1, 0, item.location.line - 1, 0), preserveFocus: true };
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.location.path), opts);
				treeProvider.curIndex -= 1;
			}
		}),

		vscode.commands.registerCommand('rdbg.trace.exception.openNextLog', async () => {
			if (view.selection.length > 0) {
				treeProvider.curIndex = view.selection[0].index;
				treeProvider.curIndex += 1;
			}
			const item = await treeProvider.getSpecificLog();
			if (item) {
				await view.reveal(item, { select: true, expand: true });
				const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(item.location.line - 1, 0, item.location.line - 1, 0), preserveFocus: true };
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.location.path), opts);
			}
		}),

		vscode.commands.registerCommand('rdbg.trace.exception.openTargetLog', async (loc: Location) => {
			if (view.selection.length > 0) {
				treeProvider.curIndex = view.selection[0].index;
			}
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

class TraceLogsTreeProvider implements vscode.TreeDataProvider<TraceLogItem> {
	public threadId: number = 0;
	public curIndex: number = 0;

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	private _onDidChangeTreeData: vscode.EventEmitter<TraceLogItem | undefined | null | void> = new vscode.EventEmitter<TraceLogItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TraceLogItem | undefined | null | void> = this._onDidChangeTreeData.event;
	getTreeItem(element: TraceLogItem): TraceLogItem {
		return element;
	}

	async getSpecificLog() {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;

		let resp: TraceLogParentResponse;
		try {
			resp = await session.customRequest('rdbgInspectorTraceLog', {
				id: this.curIndex,
				type: 'exception'
			});
		} catch (error) {
			return void 0;
		}
		if (resp.log === null || resp.log.name === null) return void 0;

		const item = new TraceLogItem(resp.log.name.slice(1).trim(), resp.log.location);
		item.id = resp.log.index.toString();
		item.index = resp.log.index;
		return item;
	}

	async getChildren(element?: TraceLogItem): Promise<TraceLogItem[]> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return [];

		if (element) {
			let resp: TraceLogChildResponse;
			try {
				resp = await session.customRequest('rdbgInspectorTraceLogChildren', {
					id: element.index,
					type: 'exception'
				});
			} catch (error) {
				return [];
			}
			return resp.logs.map((log) => {
				if (log.name === null) throw new Error('Invalid');

				let state = vscode.TreeItemCollapsibleState.None;
				if (log.hasChild !== undefined) {
					state = vscode.TreeItemCollapsibleState.Collapsed;
				}
				const item = new TraceLogItem(log.name.slice(1).trim(), log.location, state);
				item.index = log.index;
				item.description = log.location.name;
				item.id = log.index.toString();
				return item;
			});
		} else {
			let resp: TraceLogsResponse;
			try {
				resp = await session.customRequest('rdbgInspectorTraceLogs', {
					threadId: this.threadId
				});
			} catch (err) { return []; }
			if (resp.exception) {
				this.curIndex = resp.exception.size - 1;
				return resp.exception.logs.map((log) => {
					if (log.name === null) throw new Error('Invalid');

					let state = vscode.TreeItemCollapsibleState.None;
					if (log.hasChild !== undefined) {
						state = vscode.TreeItemCollapsibleState.Collapsed;
					}
					const item = new TraceLogItem(log.name.slice(1).trim(), log.location, state);
					item.index = log.index;
					item.description = log.location.name;
					item.id = log.index.toString();
					return item;
				});
			}
			return [];
		}
	}

	async getParent(element: TraceLogItem): Promise<TraceLogItem | null | undefined> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;

		let resp: TraceLogParentResponse;
		try {
			resp = await session.customRequest('rdbgInspectorTraceLogParent', {
				id: element.index,
				type: 'exception'
			});
		} catch (error) {
			return void 0;
		}
		if (resp.log === null || resp.log.name === null) return void 0;

		const item = new TraceLogItem(resp.log.name.slice(1).trim(), resp.log.location);
		item.index = resp.log.index;

		item.id = resp.log.index.toString();
		item.description = resp.log.location.name;
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
	line?: TraceLog[];
	exception?: {
		size: number;
		logs: TraceLog[]
	};
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

class TraceLogItem extends vscode.TreeItem {
	public index: number = 0;
	constructor(
		public readonly label: string,
		public readonly location: Location,
		public readonly collapsibleState?: vscode.TreeItemCollapsibleState,
	) {
		super(label, collapsibleState);
		this.command = { command: 'rdbg.trace.exception.openTargetLog', title: 'open log', arguments: [location] };
	}
}
