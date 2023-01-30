import * as vscode from 'vscode';
import { Location } from './traceLog';

export type RdbgTreeItemOptions = Pick<vscode.TreeItem, 'id' | 'iconPath' | 'collapsibleState' | 'description' | 'tooltip'> & {
	isLastPage?: boolean;
};

export class RdbgTreeItem extends vscode.TreeItem {
	isLastPage?: boolean;
	constructor(
		label: string,
		opts: RdbgTreeItemOptions = {}
	) {
		super(label, opts.collapsibleState);
		this.id = opts.id;
		this.iconPath = opts.iconPath;
		this.tooltip = opts.tooltip;
		this.description = opts.description;
	}
}

export class PagenationItem extends RdbgTreeItem {
	constructor(
		label: string,
		public readonly offset: number,
		opts: RdbgTreeItemOptions = {}
	) {
		super(label, opts);
	}
}

export class TraceLogItem extends RdbgTreeItem {
	constructor(
		label: string,
		public readonly index: number,
		public readonly location: Location,
		opts: RdbgTreeItemOptions = {},
	) {
		opts.id = index.toString();
		super(label, opts);
	}
}
