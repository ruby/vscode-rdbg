import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';

const locationIcon = new vscode.ThemeIcon('location');
const callIncomingIcon =  new vscode.ThemeIcon('call-incoming');
const callOutgoingIcon = new vscode.ThemeIcon('call-outgoing');

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
				}
			];
			const selects = await vscode.window.showQuickPick(items, { canPickMany: true });
			if (selects === undefined) return;

			for (const select of selects) {
				switch (select.label) {
					case 'trace call':
					case 'trace line':
						await sendDebugCommand(session, select.label);
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

class TraceLogsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	public threadId: number = 0;
	private resp: TraceLogsResponse = {};

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return [];

		if (element) {
			switch (element.label) {
				case 'Call':
					return this.resp.call!.map((log) => {
						const item = new vscode.TreeItem(log.name.slice(1), vscode.TreeItemCollapsibleState.None);

						if (log.name.slice(0, 1) === '>') {
							item.iconPath = callIncomingIcon;
						} else {
							item.iconPath = callOutgoingIcon;
						}
						item.description = log.location.name;
						item.command = { command: 'debugTracer.goToHere', title: 'Go To Here', arguments: [log.location] };
						return item;
					});
				case 'Line':
					return this.resp.line!.map((log) => {
						const item = new vscode.TreeItem(log.location.name, vscode.TreeItemCollapsibleState.None);
						item.iconPath = locationIcon;
						item.command = { command: 'debugTracer.goToHere', title: 'Go To Here', arguments: [log.location] };
						return item;
					});
				default:
					return [];
			}
		} else {
			try {
				this.resp = await session.customRequest('rdbgInspectorTraceLogs', {
					threadId: this.threadId
				});
			} catch (err) { return []; }
			const logs: vscode.TreeItem[] = [];
			if (this.resp.call) {
				logs.push(new vscode.TreeItem('Call', vscode.TreeItemCollapsibleState.Expanded));
			}
			if (this.resp.line) {
				logs.push(new vscode.TreeItem('Line', vscode.TreeItemCollapsibleState.Expanded));
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
	call?: { location: Location, name: string }[];
	line?: { location: Location}[];
	exception?: { location: Location, name: string }[];
	object?: { location: Location, name: string }[];
}
