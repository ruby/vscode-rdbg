import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';

const arrowCircleRight = new vscode.ThemeIcon('arrow-circle-right');
const arrowCircleLeft = new vscode.ThemeIcon('arrow-circle-left');

export function registerTraceLogsProvider(ctx: vscode.ExtensionContext) {
	const treeProvider = new TraceLogsTreeProvider();
	const view = vscode.window.createTreeView('debugCallTracer', { treeDataProvider: treeProvider });

	ctx.subscriptions.push(
		vscode.commands.registerCommand('debugCallTracer.startTrace', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			try {
				await sendDebugCommand(session, 'trace call');
			} catch (err) { }

			vscode.commands.executeCommand('setContext', 'startTraceEnabled', false);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', true);
		}),

		vscode.commands.registerCommand('debugCallTracer.stopTrace', async () => {
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
					treeProvider.threadId = event.body.threadId;
					treeProvider.refresh();
			}
		}),

		vscode.debug.onDidStartDebugSession(() => {
			vscode.commands.executeCommand('setContext', 'startTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', false);
		}),

		vscode.debug.onDidTerminateDebugSession(() => {
			treeProvider.refresh();
			vscode.commands.executeCommand('setContext', 'startTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', false);
		}),

		vscode.commands.registerCommand('debugCallTracer.openPrevLog', async () => {
			if (view.selection.length > 0) {
				treeProvider.curIndex = view.selection[0].index;
				treeProvider.curIndex -= 1;
			}
			const item = await treeProvider.getSpecificLog();
			if (item) {
				await view.reveal(item, { select: true, expand: true });
				const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(item.location.line - 1, 0, item.location.line - 1, 90) };
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.location.path), opts);
				await vscode.commands.executeCommand('editor.showCallHierarchy');
				treeProvider.curIndex -= 1;
			}
		}),

		vscode.commands.registerCommand('debugCallTracer.openNextLog', async () => {
			if (view.selection.length > 0) {
				treeProvider.curIndex = view.selection[0].index;
				treeProvider.curIndex += 1;
			}
			const item = await treeProvider.getSpecificLog();
			if (item) {
				await view.reveal(item, { select: true, expand: true });
				const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(item.location.line - 1, 0, item.location.line - 1, 90) };
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.location.path), opts);
				await vscode.commands.executeCommand('editor.showCallHierarchy');
			}
		}),

		vscode.commands.registerCommand('debugCallTracer.openTargetLog', async (loc: Location) => {
			if (view.selection.length > 0) {
				treeProvider.curIndex = view.selection[0].index;
			}
			const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(loc.line - 1, 0, loc.line - 1, 90) };
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(loc.path), opts);
			await vscode.commands.executeCommand('editor.showCallHierarchy');
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

class TraceLogsTreeProvider implements vscode.TreeDataProvider<TraceLog> {
	public threadId: number = 0;
	public curIndex: number = 0;

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	private _onDidChangeTreeData: vscode.EventEmitter<TraceLog | undefined | null | void> = new vscode.EventEmitter<TraceLog | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TraceLog | undefined | null | void> = this._onDidChangeTreeData.event;
	getTreeItem(element: TraceLog): TraceLog {
		return element;
	}

	async getSpecificLog() {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;
		let resp: TraceLogParentResponse;
		try {
			resp = await session.customRequest('rdbgInspectorTraceLog', {
				id: this.curIndex,
				type: 'call'
			});
		} catch (error) {
			return void 0;
		}
		if (resp.log === null) return void 0;
		const item = new TraceLog(resp.log.name.slice(1).trim(), resp.log.location);
		item.id = resp.log.index.toString();
		item.index = resp.log.index;
		return item;
	}

	async getChildren(element?: TraceLog): Promise<TraceLog[]> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return [];

		if (element) {
			let resp: TraceLogChildResponse;
			try {
				resp = await session.customRequest('rdbgInspectorTraceLogChildren', {
					id: element.index,
					type: 'call'
				});
			} catch (error) {
				return [];
			}
			return resp.logs.map((log) => {
				let state = vscode.TreeItemCollapsibleState.None;
				if (log.hasChild !== undefined) {
					state = vscode.TreeItemCollapsibleState.Collapsed;
				}
				const item = new TraceLog(log.name.slice(1).trim(), log.location, state);
				item.index = log.index;

				if (log.name.slice(0, 1) === '>') {
					item.iconPath = arrowCircleRight;
				} else {
					item.iconPath = arrowCircleLeft;
				}
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
			if (resp.call) {
				this.curIndex = resp.call.size - 1;
				return resp.call.logs.map((log) => {
					let state = vscode.TreeItemCollapsibleState.None;
					if (log.hasChild !== undefined) {
						state = vscode.TreeItemCollapsibleState.Collapsed;
					}
					const item = new TraceLog(log.name.slice(1).trim(), log.location, state);
					item.index = log.index;

					if (log.name.slice(0, 1) === '>') {
						item.iconPath = arrowCircleRight;
					} else {
						item.iconPath = arrowCircleLeft;
					}
					item.description = log.location.name;
					item.id = log.index.toString();
					return item;
				});
			}

			return [];
		}
	}

	async getParent(element: TraceLog): Promise<TraceLog | null | undefined> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;

		let resp: TraceLogParentResponse;
		try {
			resp = await session.customRequest('rdbgInspectorTraceLogParent', {
				id: element.index,
				type: 'call'
			});
		} catch (error) {
			return void 0;
		}
		if (resp.log === null) return void 0;
		const item = new TraceLog(resp.log.name.slice(1).trim(), resp.log.location);
		item.index = resp.log.index;

		if (resp.log.name.slice(0, 1) === '>') {
			item.iconPath = arrowCircleRight;
		} else {
			item.iconPath = arrowCircleLeft;
		}
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
		logs: { hasChild?: boolean, location: Location, name: string, index: number }[]
	};
	line?: { hasChild?: boolean, location: Location, index: number }[];
	exception?: { hasChild?: boolean, location: Location, name: string, index: number }[];
	object?: { hasChild?: boolean, location: Location, name: string, index: number }[];
}

interface TraceLogChildResponse {
	logs: { hasChild?: boolean, location: Location, name: string, index: number }[];
}

interface TraceLogParentResponse {
	log: { hasChild?: boolean, location: Location, name: string, index: number } | null;
}

class TraceLog extends vscode.TreeItem {
	public index: number = 0;
	constructor(
		public readonly label: string,
		public readonly location: Location,
		public readonly collapsibleState?: vscode.TreeItemCollapsibleState,
	) {
		super(label, collapsibleState);
		this.command = { command: 'debugCallTracer.openTargetLog', title: 'open log', arguments: [location] };
	}
}
