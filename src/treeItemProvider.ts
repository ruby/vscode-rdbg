import * as vscode from "vscode";
import { BaseLog } from "./protocol";
import { BaseLogItem, OmittedItem, RdbgTreeItem } from "./rdbgTreeItem";

const push = Array.prototype.push;

export abstract class TreeItemProvider {
	private _logItems: BaseLogItem[] = [];
	private _minDepth = Infinity;
	private _omittedItems: OmittedItem[] = [];

	protected constructor(logs: BaseLog[], private readonly _threadId?: number) {
		this._logItems = this.toLogItems(logs);
		this._minDepth = this.getMinDepth(this._logItems);
	}

	private clearArray(ary: any[]) {
		while(ary.length > 0) {
			ary.pop();
		}
	}

	private topItem(idx: number) {
		return idx === 0;
	}

	getBottomLogItem() {
		return this._logItems[this._logItems.length - 1];
	}

	getLogItem(idx: number) {
		return this._logItems[idx];
	}

	async getNextLogItem(selected: RdbgTreeItem) {
		let idx: number;
		let item: RdbgTreeItem;
		switch (true) {
			case selected instanceof BaseLogItem:
				idx = (selected as BaseLogItem).index;
				item = this.getLogItem(idx + 1);
				return item;
			case selected instanceof OmittedItem:
				const omit = selected as OmittedItem;
				item = this.getLogItem(omit.offset);
				return item;
		}
	}

	async getPrevLogItem(selected: RdbgTreeItem) {
		let idx: number;
		let item: RdbgTreeItem | undefined;
		switch (true) {
			case selected instanceof BaseLogItem:
				const traceItem = selected as BaseLogItem;
				idx = traceItem.index;
				if (this.topItem(idx)) {
					return;
				}
				return this.getLogItem(idx - 1);
			case selected instanceof OmittedItem:
				item = selected.parent;
				return item;
		}
	}

	private hasChild(logs: BaseLog[], index: number) {
		const target = logs[index];
		return logs[index + 1] && logs[index + 1].depth > target.depth;
	}

	public async createTree() {
		this.clearArray(this._omittedItems);
		const items: RdbgTreeItem[] = [];
		if (this._logItems[0].depth > this._minDepth) {
			const omitted = new OmittedItem(0, this._minDepth, this._threadId);
			this._omittedItems.push(omitted);
			items.push(omitted);
		}
		const traceItem = this.listLogItems(this._logItems, this._minDepth);
		push.apply(items, traceItem);
		const stack = items.concat();
		while (true) {
			const item = stack.pop();
			if (item === undefined) {
				break;
			}
			const children: RdbgTreeItem[] = [];
			let subArray: BaseLogItem[];
			let childLogs: BaseLogItem[];
			let childEnd: number;
			let childMinDepth = Infinity;
			let traceItem: BaseLogItem[];
			switch (true) {
				case item instanceof BaseLogItem:
					const idx = (item as BaseLogItem).index;
					subArray = this._logItems.slice(idx + 1);
					childEnd = subArray.length - 1;
					for (let i = 0; i < subArray.length; i++) {
						if (subArray[i].depth <= this._logItems[idx].depth) {
							childEnd = i;
							break;
						}									 
					}
					childLogs = subArray.slice(0, childEnd);
					childMinDepth = this.getMinDepth(childLogs);
					if (childLogs[0] && childLogs[0].depth > childMinDepth) {
						const o = new OmittedItem(childLogs[0].index, childMinDepth, this._threadId);
						this._omittedItems.push(o);
						children.push(o);
					}
					traceItem = this.listLogItems(childLogs, childMinDepth);
					push.apply(children, traceItem);
					// Do not await
					this.setParentChild(children, item);
					break;
				case item instanceof OmittedItem:
					const omitted = item as OmittedItem;
					subArray = this._logItems.slice(omitted.offset);
					childEnd = subArray.length - 1;
					for (let i = 0; i < subArray.length; i++) {
						if (subArray[i].depth === omitted.depth) {
							childEnd = i;
							break;
						}
					}
					childLogs = subArray.slice(0, childEnd);
					childMinDepth = this.getMinDepth(childLogs);
					if (childLogs[0].depth > childMinDepth) {
						const o = new OmittedItem(omitted.offset, childMinDepth, this._threadId);
						this._omittedItems.push(o);
						children.push(o);
					}
					traceItem = this.listLogItems(childLogs, childMinDepth);
					push.apply(children, traceItem);
					// Do not await
					this.setParentChild(children, item);
					break;
			}
			for (const child of children) {
				if (child.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
					stack.push(child);
				}
			}
		}
		return items;
	}

	private toLogItems(logs: BaseLog[]) {
		const items: BaseLogItem[] = [];
		logs.forEach((log, idx) => {
			let state = vscode.TreeItemCollapsibleState.None;
			if (this.hasChild(logs, idx)) {
				state = vscode.TreeItemCollapsibleState.Collapsed;
			}
			items.push(this.newLogItem(log, idx, state));
		});
		return items;
	}

	protected abstract newLogItem(log: BaseLog, idx: number, state: vscode.TreeItemCollapsibleState): BaseLogItem;

	private listLogItems(logs: BaseLogItem[], depth: number) {
		const root: BaseLogItem[] = [];
		for (const log of logs) {
			if (log.depth === depth) {
				root.push(log);
			}
		}
		return root;
	}

	private async setParentChild(children: RdbgTreeItem[], parent: RdbgTreeItem) {
		parent.children = children;
		for (const child of children) {
			child.parent = parent;
		}
	}

	async getParent(element: RdbgTreeItem): Promise<RdbgTreeItem | null | undefined> {
		const session = vscode.debug.activeDebugSession;
		if (session === undefined) return void 0;

		return element.parent;
	}

	private getMinDepth(logs: BaseLogItem[]) {
		let min = Infinity;
		for (const log of logs) {
			if (log.depth < min) {
				min = log.depth;
			}
		}
		return min;
	}
}
