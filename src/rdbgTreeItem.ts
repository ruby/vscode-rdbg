import * as vscode from 'vscode';
import { Location } from './traceLog';

const foldUpIcon = new vscode.ThemeIcon('fold-up', new vscode.ThemeColor('textLink.foreground'));

export type RdbgTreeItemOptions = Pick<vscode.TreeItem, 'id' | 'iconPath' | 'collapsibleState' | 'description' | 'tooltip' | 'resourceUri' | 'command'> & {
	isLastPage?: boolean;
};

export class RdbgTreeItem extends vscode.TreeItem {
	isLastPage?: boolean;
  public parent?: RdbgTreeItem;
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
		this.command = opts.command;
	}
}

export class LoadMoreItem extends RdbgTreeItem {
	constructor() {
		super('Load More Logs', {
			resourceUri: vscode.Uri.parse('http://example.com'),
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
		opts: RdbgTreeItemOptions = {},
	) {
		opts.id = index.toString();
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
