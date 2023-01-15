import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';

const locationIcon = new vscode.ThemeIcon('location');
const arrowCircleRight = new vscode.ThemeIcon('arrow-circle-right');
const arrowCircleLeft = new vscode.ThemeIcon('arrow-circle-left');
const errorIcon = new vscode.ThemeIcon('error');

export function registerTraceLogsProvider(ctx: vscode.ExtensionContext) {
	const provider = new TraceLogsProvider();
	ctx.subscriptions.push(
		vscode.window.registerTreeDataProvider('debugTracer', provider),

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
					provider.threadId = event.body.threadId;
					provider.refresh();
			}
		}),

		vscode.commands.registerCommand('debugTracer.goToHere', async (location: Location) => {
			const doc = await vscode.workspace.openTextDocument(location.path);
			const editor = await vscode.window.showTextDocument(doc);
			const line = location.line;
			editor.selection = new vscode.Selection(new vscode.Position(line, 0), new vscode.Position(line, 0));
			editor.revealRange(new vscode.Range(line, 0, line, 0));
		}),

		vscode.debug.onDidStartDebugSession(() => {
			vscode.commands.executeCommand('setContext', 'startTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', false);
		}),

		vscode.debug.onDidTerminateDebugSession(() => {
			provider.refresh();
			vscode.commands.executeCommand('setContext', 'startTraceEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopTraceEnabled', false);
		})
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

class TraceLogsProvider implements vscode.TreeDataProvider<TraceLog> {
	public threadId: number = 0;
	private resp: TraceLogsResponse = {};

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	private _onDidChangeTreeData: vscode.EventEmitter<TraceLog | undefined | null | void> = new vscode.EventEmitter<TraceLog | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TraceLog | undefined | null | void> = this._onDidChangeTreeData.event;
	getTreeItem(element: TraceLog): TraceLog {
		return element;
	}

	async getChildren(element?: TraceLog): Promise<TraceLog[]> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return [];

		if (element) {
			switch (element.label) {
				case 'CALL':
					return this.resp.call!.map((log) => {
						let state = vscode.TreeItemCollapsibleState.None;
						if (log.childReference !== undefined) {
							state = vscode.TreeItemCollapsibleState.Collapsed;
						}
						const item = new TraceLog(log.name.slice(1).trim(), state);
						item.index = log.childReference;

						if (log.name.slice(0, 1) === '>') {
							item.iconPath = arrowCircleRight;
						} else {
							item.iconPath = arrowCircleLeft;
						}
						item.description = log.location.name;
						item.location = log.location;
						item.type = 'call';
						// item.command = { command: 'debugTracer.goToHere', title: 'Go To Here', arguments: [log.location] };
						return item;
					});
				case 'LINE':
					return this.resp.line!.map((log) => {
						let state = vscode.TreeItemCollapsibleState.None;
						if (log.childReference !== undefined) {
							state = vscode.TreeItemCollapsibleState.Collapsed;
						}
						const item = new TraceLog(log.location.name, state);
						item.index = log.childReference;
						item.iconPath = locationIcon;
						// item.command = { command: 'debugTracer.goToHere', title: 'Go To Here', arguments: [log] };
						item.type = 'line';
						return item;
					});
				case 'EXCEPTION':
					return this.resp.exception!.map((log) => {
						let state = vscode.TreeItemCollapsibleState.None;
						if (log.childReference !== undefined) {
							state = vscode.TreeItemCollapsibleState.Collapsed;
						}
						const item = new TraceLog(log.name.slice(1).trim(), state);
						item.index = log.childReference;

						item.iconPath = errorIcon;
						item.description = log.location.name;
						item.location = log.location;
						item.type = 'call';
						// item.command = { command: 'debugTracer.goToHere', title: 'Go To Here', arguments: [log.location] };
						return item;
					});
				case 'OBJECT':
					return this.resp.object!.map((log) => {
						let state = vscode.TreeItemCollapsibleState.None;
						if (log.childReference !== undefined) {
							state = vscode.TreeItemCollapsibleState.Collapsed;
						}
						const item = new TraceLog(log.name.slice(1).trim(), state);
						item.index = log.childReference;

						item.iconPath = errorIcon;
						item.description = log.location.name;
						item.location = log.location;
						item.type = 'call';
						// item.command = { command: 'debugTracer.goToHere', title: 'Go To Here', arguments: [log.location] };
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
								if (log.childReference !== undefined) {
									state = vscode.TreeItemCollapsibleState.Collapsed;
								}
								const item = new TraceLog(log.location.name, state);
								item.index = log.childReference;
								item.iconPath = locationIcon;
								// item.command = { command: 'debugTracer.goToHere', title: 'Go To Here', arguments: [log] };
								item.type = 'line';
								return item;
							});
						case 'call':
							return resp.logs.map((log) => {
								let state = vscode.TreeItemCollapsibleState.None;
								if (log.childReference !== undefined) {
									state = vscode.TreeItemCollapsibleState.Collapsed;
								}
								const item = new TraceLog(log.name.slice(1).trim(), state);
								item.index = log.childReference;

								if (log.name.slice(0, 1) === '>') {
									item.iconPath = arrowCircleRight;
								} else {
									item.iconPath = arrowCircleLeft;
								}
								item.description = log.location.name;
								// item.command = { command: 'debugTracer.goToHere', title: 'Go To Here', arguments: [log.location] };
								return item;
							});
						case 'object':
						case 'exception':
							return resp.logs.map((log) => {
								let state = vscode.TreeItemCollapsibleState.None;
								if (log.childReference !== undefined) {
									state = vscode.TreeItemCollapsibleState.Collapsed;
								}
								const item = new TraceLog(log.name.slice(1).trim(), state);
								item.index = log.childReference;

								item.iconPath = errorIcon;
								item.description = log.location.name;
								// item.command = { command: 'debugTracer.goToHere', title: 'Go To Here', arguments: [log.location] };
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
}

interface Location {
	name: string;
	path: string;
	line: number;
}

interface TraceLogsResponse {
	call?: { childReference?: number, location: Location, name: string }[];
	line?: { childReference?: number, location: Location }[];
	exception?: { childReference?: number, location: Location, name: string }[];
	object?: { childReference?: number, location: Location, name: string }[];
}

interface TraceLogChildResponse {
	logs: { childReference?: number, location: Location, name: string }[];
}

class TraceLog extends vscode.TreeItem {
	public index: number | undefined;
	public location: Location | undefined;
	public type: string | undefined;
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
	) {
		super(label, collapsibleState);
	}
}
