import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';

export class ExecLogsProvider implements vscode.TreeDataProvider<ExecLog | ExecLogChild> {
	private threadId: number = 0;
	private currentLogIdx: number = 0;
	constructor(private readonly session: vscode.DebugSession) {
		vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
			switch (event.event) {
				case 'execLogsUpdated':
					this.threadId = event.body.threadId;
					this._onDidChangeTreeData.fire();
			}
		});
		vscode.commands.registerCommand('historyInspector.startRecord', async () => {
			try {
				await this.session.customRequest('rdbgInspectorStartRecord');
			} catch (err) { }
		});
		vscode.commands.registerCommand('historyInspector.stopRecord', async () => {
			try {
				await this.session.customRequest('rdbgInspectorStopRecord');
			} catch (err) { }
		});
		vscode.commands.registerCommand('historyInspector.goToHere', async (arg: ExecLogChild) => {
			let cmd: string;
			let times = this.currentLogIdx - arg.index;
			if (times > 0) {
				cmd = 'rdbgInspectorStepBack';
			} else {
				cmd = 'rdbgInspectorStepInto';
				times = Math.abs(times);
			};
			try {
				await this.session.customRequest(cmd, { times });
			} catch (err) { }
		});
	}

	private _onDidChangeTreeData: vscode.EventEmitter<ExecLog | ExecLogChild | undefined | null | void> = new vscode.EventEmitter<ExecLog | ExecLogChild | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<ExecLog | ExecLogChild | undefined | null | void> = this._onDidChangeTreeData.event;
	getTreeItem(element: ExecLog | ExecLogChild): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ExecLog | ExecLogChild): Promise<ExecLog[] | ExecLogChild[]> {
		if (element) {
			let resp: execLogsChildResponse;
			try {
				resp = await this.session.customRequest('rdbgInspectorExecLogsChild', {
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
				return new ExecLogChild(label, vscode.TreeItemCollapsibleState.None, loc.index);
			});
		} else {
			let resp: execLogsResponse;
			try {
				resp = await this.session.customRequest('rdbgInspectorExecLogs', {
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
				return new ExecLog(label, state, index, frame.arguments);
			});
		}
	}
}

interface execLogsResponse {
	frames: { name: string, arguments: string[], currentLocation?: boolean }[];
}

interface execLogsChildResponse {
	locations: { name: string, index: number }[];
	logIndex: number;
}

class ExecLog extends vscode.TreeItem {
	constructor(
		public readonly label: vscode.TreeItemLabel,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly index: number,
		private readonly args: string[],
	) {
		super(label, collapsibleState);
		this.tooltip = `Frame: ${this.label.label} Argument: ${this.args.join(" ")}`;
		this.description = this.args.join(" ");
	}
}

class ExecLogChild extends vscode.TreeItem {
	constructor(
		public readonly label: vscode.TreeItemLabel,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly index: number,
	) {
		super(label, collapsibleState);
		this.tooltip = this.label.label;
		this.contextValue = 'goToHere';
	}
}

