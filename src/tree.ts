import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';

const locationId = 'location';
const groupByRefTypeId = 'group-by-ref-type';

export function registerExecLogsProvider(ctx: vscode.ExtensionContext) {
	const provider = new ExecLogsProvider();
	ctx.subscriptions.push(
		vscode.window.registerTreeDataProvider('debugReplayer', provider),

		vscode.commands.registerCommand('debugReplayer.startRecord', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			vscode.commands.executeCommand('setContext', 'startRecordEnabled', false);
			vscode.commands.executeCommand('setContext', 'stopRecordEnabled', true);
			try {
				await sendDebugCommand(session, 'record on');
			} catch (err) { }
		}),

		vscode.commands.registerCommand('debugReplayer.stopRecord', async () => {
			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}
			vscode.commands.executeCommand('setContext', 'startRecordEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopRecordEnabled', false);
			try {
				await sendDebugCommand(session, 'record off');
			} catch (err) { }
		}),

		vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
			switch (event.event) {
				case 'rdbgInspectorExecLogsUpdated':
					provider.threadId = event.body.threadId;
					provider.refresh();
			}
		}),

		vscode.commands.registerCommand('debugReplayer.goToHere', async (index: number | undefined) => {
			if (index === undefined) return;

			const session = vscode.debug.activeDebugSession;
			if (session === undefined) {
				vscode.window.showErrorMessage('Failed to get active debug session');
				return;
			}

			let cmd: string;
			const times = provider.currentLogIndex - index;
			if (times > 0) {
				cmd = `step back ${times}`;
			} else {
				cmd = `s ${Math.abs(times)}`;
			};
			try {
				await sendDebugCommand(session, cmd);
			} catch (err) { }
		}),

		vscode.debug.onDidStartDebugSession(() => {
			vscode.commands.executeCommand('setContext', 'startRecordEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopRecordEnabled', false);
		}),

		vscode.debug.onDidTerminateDebugSession(() => {
			provider.refresh();
			vscode.commands.executeCommand('setContext', 'startRecordEnabled', true);
			vscode.commands.executeCommand('setContext', 'stopRecordEnabled', false);
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

class ExecLogsProvider implements vscode.TreeDataProvider<ExecLog | ExecLogChild> {
	public threadId: number = 0;
	private currentLogIdx: number = 0;

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	get currentLogIndex() {
		return this.currentLogIdx;
	}

	private _onDidChangeTreeData: vscode.EventEmitter<ExecLog | ExecLogChild | undefined | null | void> = new vscode.EventEmitter<ExecLog | ExecLogChild | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<ExecLog | ExecLogChild | undefined | null | void> = this._onDidChangeTreeData.event;
	getTreeItem(element: ExecLog | ExecLogChild): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ExecLog): Promise<ExecLog[] | ExecLogChild[]> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return [];

		if (element) {
			let resp: execLogsChildResponse;
			try {
				resp = await session.customRequest('rdbgInspectorExecLogsChild', {
					index: element.index,
					threadId: this.threadId
				});
			} catch (err) { return []; }
			this.currentLogIdx = resp.logIndex;
			return resp.locations.map((loc) => {
				const label: vscode.TreeItemLabel = {
					label: loc.name,
				};
				if (loc.index === resp.logIndex) {
					label.highlights = [[0, loc.name.length]];
				}
				return new ExecLogChild(label, vscode.TreeItemCollapsibleState.None, loc.index, locationId);
			});
		} else {
			let resp: execLogsResponse;
			try {
				resp = await session.customRequest('rdbgInspectorExecLogs', {
					threadId: this.threadId
				});
			} catch (err) { return []; }
			return resp.frames.map((frame, index) => {
				const label: vscode.TreeItemLabel = {
					label: frame.name
				};
				let state = vscode.TreeItemCollapsibleState.Collapsed;
				if (frame.currentLocation) {
					label.highlights = [[0, frame.name.length]];
					state = vscode.TreeItemCollapsibleState.Expanded;
				}
				return new ExecLog(label, state, index, frame.arguments, groupByRefTypeId);
			});
		}
	}
}

interface execLogsResponse {
	frames: { name: string, arguments: Argument[], currentLocation?: boolean }[];
}

interface execLogsChildResponse {
	locations: { name: string, index: number }[];
	logIndex: number;
}

interface Argument {
	name: string;
	value: any;
}

class ExecLog extends vscode.TreeItem {
	constructor(
		public readonly label: vscode.TreeItemLabel,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly index: number,
		private readonly args: Argument[],
		private readonly iconId: string,
	) {
		super(label, collapsibleState);
		this.tooltip = `Frame Name: ${this.label.label}`;
		if (this.args.length > 0) {
			let argString = '';
			this.args.forEach((arg) => {
				argString += `${arg.name}=${arg.value} `;
			});
			this.description = `args: ${argString}`;
			this.tooltip += ` Arguments: ${argString}`;
		}
		this.iconPath = new vscode.ThemeIcon(this.iconId);
	}
}

class ExecLogChild extends vscode.TreeItem {
	constructor(
		public readonly label: vscode.TreeItemLabel,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly index: number,
		private readonly iconId: string,
	) {
		super(label, collapsibleState);
		this.tooltip = this.label.label;
		this.command = { command: 'debugReplayer.goToHere', title: 'Go To Here', arguments: [this.index] };
		this.iconPath = new vscode.ThemeIcon(this.iconId);
	}
}

