import * as vscode from 'vscode';
import { Location, RdbgTraceInspectorDisableArguments, RdbgTraceInspectorEnableArguments } from './traceLog';

const foldUpIcon = new vscode.ThemeIcon('fold-up', new vscode.ThemeColor('textLink.foreground'));

export type RdbgTreeItemOptions = Pick<vscode.TreeItem, 'id' | 'iconPath' | 'collapsibleState' | 'description' | 'tooltip' | 'resourceUri'> & {
	command?: {command: string, arguments?: any[]};
};

export class RdbgTreeItem extends vscode.TreeItem {
	public parent?: RdbgTreeItem;
	public children?: RdbgTreeItem[];
	constructor(
  	label: string,
  	opts: RdbgTreeItemOptions = {}
	) {
  	super(label, opts.collapsibleState);
  	this.id = opts.id;
  	this.iconPath = opts.iconPath;
  	this.tooltip = opts.tooltip;
  	this.description = opts.description;
  	this.resourceUri = opts.resourceUri;
		if (opts.command) {
			const command = 'rdbg.' + opts.command.command;
			this.command = { title: command, command, arguments: opts.command.arguments };
		}
	}
}

export class LoadMoreItem extends RdbgTreeItem {
	constructor() {
		super('Load More Logs', {
			command: { command: 'loadMoreLogs' },
			resourceUri: vscode.Uri.parse('http://example.com?item=load'),
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			iconPath: foldUpIcon,
		});
	}
}

export class TraceLogItem extends RdbgTreeItem {
	constructor(
		label: string,
		public readonly index: number,
    public readonly depth: number,
		public readonly location: Location,
    public readonly threadId: number,
    opts: RdbgTreeItemOptions = {},
	) {
		const idx = index.toString();
		opts.id = idx;
		opts.tooltip = location.path;
		opts.resourceUri = vscode.Uri.parse('http://example.com?item=trace&index=' + idx);
		super(label, opts);
	}
}

export class OmittedItem extends RdbgTreeItem {
	constructor(
    public readonly index: number,
		public readonly offset: number,
		public readonly depth: number
	) {
		super('..', { collapsibleState: vscode.TreeItemCollapsibleState.Expanded });
	}
}

export class RootLogItem extends RdbgTreeItem {
	constructor(
	){
		super('Trace Logs', { collapsibleState: vscode.TreeItemCollapsibleState.Expanded });
	}
}

const playCircleIcon = new vscode.ThemeIcon('play-circle');
const stopCircleIcon = new vscode.ThemeIcon('stop-circle');
export class ToggleTreeItem extends RdbgTreeItem {
	private _enabled = false;
	constructor(
	){
		super('Start Trace', {
			command: { command: 'toggleTrace' },
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			iconPath: playCircleIcon
		});
	}

	async toggle(items: vscode.QuickPickItem[]) {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) {
			return;
		}
		if (this._enabled) {
			this.iconPath = playCircleIcon;
			this.label = 'Start Trace';
			try {
				const args: RdbgTraceInspectorDisableArguments = {
					command: 'disable',
				};
				await session.customRequest('rdbgTraceInspector', args);
			} catch (err) { }
			this._enabled = false;
		} else {
			this.iconPath = stopCircleIcon;
			this.label = 'Stop Trace';
      const events: ('line' | 'call' | 'return')[] = [];
      for (const item of items) {
        if (item.picked) {
          let evt: ('line' | 'call' | 'return');
          switch (item.label) {
            case 'Line':
              evt = 'line'
              break;
            case 'Call':
              evt = 'call'
              break;
            default:
              evt = 'return'
              break;
          }
          events.push(evt);
        }
      }
			try {
				const args: RdbgTraceInspectorEnableArguments = {
					command: 'enable',
					events
				};
				await session.customRequest('rdbgTraceInspector', args);
			} catch (err) { }
			this._enabled = true;
		}
	}
}

const passFilledIcon = new vscode.ThemeIcon('pass-filled');
const circleLargeOutlineIcon = new vscode.ThemeIcon('circle-large-outline');
export class TraceEventPickItem extends RdbgTreeItem {
	public enabled = true;
	constructor(
		label: string
	){
		super(label, {
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			iconPath: passFilledIcon,
			command: {
				command: 'changePickItemState',
			} 
		});
    if (this.command) {
		this.command.arguments = [this];
    }
	}

	changeState() {
		if (this.enabled) {
			this.disable();
		} else {
			this.enable();
		}
	}

	private enable() {
		this.iconPath = passFilledIcon;
		this.enabled = true;
	}

	private disable() {
		this.iconPath =circleLargeOutlineIcon;
		this.enabled = false;
	}
}

export class TraceEventRootItem extends RdbgTreeItem {
	constructor(
	){
		super('Trace Events', { collapsibleState: vscode.TreeItemCollapsibleState.Collapsed });
	}
}
