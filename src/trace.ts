import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';


const locationIcon = new vscode.ThemeIcon('location');
const arrowCircleRight = new vscode.ThemeIcon('arrow-circle-right');
const arrowCircleLeft = new vscode.ThemeIcon('arrow-circle-left');
const errorIcon = new vscode.ThemeIcon('error');

export function registerTraceLogsProvider(ctx: vscode.ExtensionContext) {
	const treeProvider = new TraceLogsTreeProvider();
	const view = vscode.window.createTreeView('debugTracer', { treeDataProvider: treeProvider });

	ctx.subscriptions.push(
		vscode.commands.registerCommand('debugTracer.startTrace', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}

			const items: vscode.QuickPickItem[] = [
				{
					label: 'trace line',
					description: 'Trace line events.'
				},
				{
					label: 'trace call',
					description: 'Trace call/return events.'
				},
				{
					label: 'trace exception',
					description: 'Trace raising exceptions.'
				},
				{
					label: 'trace object <expression>',
					description: 'Trace an object by <expression> is passed as a parameter or a receiver on method call.'
				}
			];
			const selects = await vscode.window.showQuickPick(items, { canPickMany: true });
			if (selects === undefined) return;

			for (const select of selects) {
				switch (select.label) {
					case 'trace call':
					case 'trace line':
					case 'trace exception':
						await sendDebugCommand(session, select.label);
						break;
					case 'trace object <expression>':
						const expr = await vscode.window.showInputBox({ title: 'expression' });
						await sendDebugCommand(session, `trace object ${expr}`);
						break;
				}
			}

			vscode.commands.executeCommand('setContext', 'startTraceEnabled', false);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', true);
		}),

		vscode.commands.registerCommand('debugTracer.stopTrace', async () => {
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

		// vscode.commands.registerCommand('debugTracer.goToHere', async (location: Location) => {
		// 	const doc = await vscode.workspace.openTextDocument(location.path);
		// 	const editor = await vscode.window.showTextDocument(doc);
		// 	const line = location.line;
		// 	editor.selection = new vscode.Selection(new vscode.Position(line, 0), new vscode.Position(line, 0));
		// 	editor.revealRange(new vscode.Range(line, 0, line, 0));
		// }),

		vscode.debug.onDidStartDebugSession(() => {
			vscode.commands.executeCommand('setContext', 'startTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', false);
		}),

		vscode.debug.onDidTerminateDebugSession(() => {
			treeProvider.refresh();
			vscode.commands.executeCommand('setContext', 'startTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', false);
		}),

		vscode.commands.registerCommand('debugTracer.goToPrevLog', async () => {
			const item = await treeProvider.getSpecificLog();
			if (item) {
				await view.reveal(item, { select: true, expand: true });
				const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(item.location.line - 1, 0, item.location.line - 1, 90) };
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.location.path), opts);
				await vscode.commands.executeCommand('editor.showCallHierarchy');
				treeProvider.curIndex -= 1;
			}
		}),

		vscode.commands.registerCommand('debugTracer.goToNextLog', async () => {
			const item = await treeProvider.getSpecificLog();
			if (item) {
				await view.reveal(item, { select: true, expand: true });
				const opts: vscode.TextDocumentShowOptions = { selection: new vscode.Range(item.location.line - 1, 0, item.location.line - 1, 90) };
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.location.path), opts);
				await vscode.commands.executeCommand('editor.showCallHierarchy');
				treeProvider.curIndex += 1;
			}
		}),

		vscode.languages.registerCallHierarchyProvider('ruby', new TracerHierarchyProvider(treeProvider))
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
	public resp: TraceLogsResponse = {};
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
		const item = new TraceLog(resp.log.name.slice(1).trim(), vscode.TreeItemCollapsibleState.None);
		item.id = resp.log.index.toString();
		item.index = resp.log.index;
		item.type = 'call';
		item.location = resp.log.location;
		return item;
	}

	async getChildren(element?: TraceLog): Promise<TraceLog[]> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return [];

		if (element) {
			switch (element.label) {
				case 'CALL':
					const foo = this.resp.call!.logs.map((log) => {
						let state = vscode.TreeItemCollapsibleState.None;
						if (log.hasChild !== undefined) {
							state = vscode.TreeItemCollapsibleState.Collapsed;
						}
						const item = new TraceLog(log.name.slice(1).trim(), state);
						item.index = log.index;

						if (log.name.slice(0, 1) === '>') {
							item.iconPath = arrowCircleRight;
						} else {
							item.iconPath = arrowCircleLeft;
						}
						item.description = log.location.name;
						item.location = log.location;
						item.type = 'call';
						item.id = log.index.toString();
						item.location = log.location;
						return item;
					});
					return foo;
				case 'LINE':
					return this.resp.line!.map((log) => {
						let state = vscode.TreeItemCollapsibleState.None;
						if (log.hasChild) {
							state = vscode.TreeItemCollapsibleState.Collapsed;
						}
						const item = new TraceLog(log.location.name, state);
						item.index = log.index;
						item.iconPath = locationIcon;
						item.type = 'line';
						return item;
					});
				case 'EXCEPTION':
					return this.resp.exception!.map((log) => {
						let state = vscode.TreeItemCollapsibleState.None;
						if (log.hasChild) {
							state = vscode.TreeItemCollapsibleState.Collapsed;
						}
						const item = new TraceLog(log.name.slice(1).trim(), state);
						item.index = log.index;

						item.iconPath = errorIcon;
						item.description = log.location.name;
						item.location = log.location;
						return item;
					});
				case 'OBJECT':
					return this.resp.object!.map((log) => {
						let state = vscode.TreeItemCollapsibleState.None;
						if (log.hasChild) {
							state = vscode.TreeItemCollapsibleState.Collapsed;
						}
						const item = new TraceLog(log.name.slice(1).trim(), state);
						item.index = log.index;

						item.iconPath = errorIcon;
						item.description = log.location.name;
						item.location = log.location;
						item.type = 'call';
						return item;
					});
				default:
					let resp: TraceLogChildResponse;
					try {
						resp = await session.customRequest('rdbgInspectorTraceLogChildren', {
							id: element.index,
							type: element.type
						});
					} catch (error) {
						return [];
					}
					switch (element.type) {
						case 'line':
							return resp.logs.map((log) => {
								let state = vscode.TreeItemCollapsibleState.None;
								if (log.hasChild !== undefined) {
									state = vscode.TreeItemCollapsibleState.Collapsed;
								}
								const item = new TraceLog(log.location.name, state);
								item.index = log.index;
								item.iconPath = locationIcon;
								item.type = 'line';
								return item;
							});
						case 'call':
							return resp.logs.map((log) => {
								let state = vscode.TreeItemCollapsibleState.None;
								if (log.hasChild !== undefined) {
									state = vscode.TreeItemCollapsibleState.Collapsed;
								}
								const item = new TraceLog(log.name.slice(1).trim(), state);
								item.index = log.index;

								if (log.name.slice(0, 1) === '>') {
									item.iconPath = arrowCircleRight;
								} else {
									item.iconPath = arrowCircleLeft;
								}
								item.description = log.location.name;
								item.id = log.index.toString();
								item.type = 'call';
								item.location = log.location;
								return item;
							});
						case 'object':
						case 'exception':
							return resp.logs.map((log) => {
								let state = vscode.TreeItemCollapsibleState.None;
								if (log.hasChild !== undefined) {
									state = vscode.TreeItemCollapsibleState.Collapsed;
								}
								const item = new TraceLog(log.name.slice(1).trim(), state);
								item.index = log.index;

								item.iconPath = errorIcon;
								item.description = log.location.name;
								return item;
							});
						default:
							return [];
					}
			}
		} else {
			try {
				this.resp = await session.customRequest('rdbgInspectorTraceLogs', {
					threadId: this.threadId
				});
			} catch (err) { return []; }
			const logs: TraceLog[] = [];
			if (this.resp.call) {
				this.curIndex = this.resp.call.size - 1;
				logs.push(new TraceLog('CALL', vscode.TreeItemCollapsibleState.Expanded));
			}
			if (this.resp.line) {
				logs.push(new TraceLog('LINE', vscode.TreeItemCollapsibleState.Expanded));
			}
			if (this.resp.exception) {
				logs.push(new TraceLog('EXCEPTION', vscode.TreeItemCollapsibleState.Expanded));
			}
			if (this.resp.object) {
				logs.push(new TraceLog('OBJECT', vscode.TreeItemCollapsibleState.Expanded));
			}
			return logs;
		}
	}

	async getParent(element: TraceLog): Promise<TraceLog | null | undefined> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;

		let resp: TraceLogParentResponse;
		try {
			resp = await session.customRequest('rdbgInspectorTraceLogParent', {
				id: element.index,
				type: element.type
			});
		} catch (error) {
			return void 0;
		}
		if (resp.log === null) return void 0;
		const item = new TraceLog(resp.log.name.slice(1).trim(), vscode.TreeItemCollapsibleState.Expanded);
		item.index = resp.log.index;

		if (resp.log.name.slice(0, 1) === '>') {
			item.iconPath = arrowCircleRight;
		} else {
			item.iconPath = arrowCircleLeft;
		}
		item.id = resp.log.index.toString();
		item.description = resp.log.location.name;
		item.type = 'call';
		item.location = resp.log.location;
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
	public location: Location = {
		name: '',
		path: '',
		line: 0
	};
	public index: number = 0;
	public type: string | undefined;
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
	) {
		super(label, collapsibleState);
	}
}

class TracerHierarchyProvider implements vscode.CallHierarchyProvider {
	constructor(readonly treeProvider: TraceLogsTreeProvider) { }

	async prepareCallHierarchy(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.CallHierarchyItem | vscode.CallHierarchyItem[] | null | undefined> {
		const item = await this.treeProvider.getSpecificLog();
		if (item === undefined) return void 0;
		const uri = vscode.Uri.file(item.location.path);
		const range = new vscode.Range(item.location.line - 1, 0, item.location.line - 1, 100);
		const hierarchy = new TraceLog2(vscode.SymbolKind.Method, item.label, '', uri, range, range);
		hierarchy.index = item.index;
		hierarchy.type = item.type;
		return hierarchy;
	}

	async provideCallHierarchyIncomingCalls(item: TraceLog2, token: vscode.CancellationToken): Promise<vscode.CallHierarchyIncomingCall[] | null | undefined> {
		const a = new TraceLog(item.name, vscode.TreeItemCollapsibleState.None);
		a.index = item.index;
		a.type = item.type;
		const b = await this.treeProvider.getChildren(a);
		if (b.length > 0) {
			return b.map((log) => {
				const uri = vscode.Uri.file(log.location.path);
				const range = new vscode.Range(log.location.line - 1, 0, log.location.line - 1, 100);
				const hierarchy = new TraceLog2(vscode.SymbolKind.Method, log.label, '', uri, range, range);
				hierarchy.index = log.index;
				hierarchy.type = log.type;
				return new vscode.CallHierarchyIncomingCall(hierarchy, [range]);
			});
		}
		return void 0;
	}

	async provideCallHierarchyOutgoingCalls(item: TraceLog2, token: vscode.CancellationToken): Promise<vscode.CallHierarchyOutgoingCall[] | null | undefined> {
		const a = new TraceLog(item.name, vscode.TreeItemCollapsibleState.None);
		a.index = item.index;
		a.type = item.type;
		const b = await this.treeProvider.getParent(a);
		if (b) {
			const uri = vscode.Uri.file(b.location.path);
			const range = new vscode.Range(b.location.line - 1, 0, b.location.line - 1, 100);
			const hierarchy = new TraceLog2(vscode.SymbolKind.Method, b.label, '', uri, range, range);
			hierarchy.index = b.index;
			hierarchy.type = b.type;
			return [new vscode.CallHierarchyOutgoingCall(hierarchy, [range])];
		}
		return void 0;
	}
}

class TraceLog2 extends vscode.CallHierarchyItem {
	public index: number = 0;
	public type: string | undefined;
	constructor(kind: vscode.SymbolKind, name: string, detail: string, uri: vscode.Uri, range: vscode.Range, selectionRange: vscode.Range) {
		super(kind, name, detail, uri, range, selectionRange);
	}
}
