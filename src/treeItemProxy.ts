import {
    BaseLog,
    RdbgRecordInspectorCollectArguments,
    RdbgRecordInspectorPlayBackArguments,
    RdbgTraceInspectorLogsArguments,
    RecordLog,
    RecordLogsResponse,
    TraceLog,
    TraceLogsResponse,
} from "./protocol";
import {
    BaseLogItem,
    CallTraceLogItem,
    LineTraceLogItem,
    LoadMoreItem,
    OmittedItem,
    RdbgTreeItem,
    RecordLogItem,
    RootLogItem,
    ThreadIdItem,
    ToggleTreeItem,
    TraceLogItem,
} from "./rdbgTreeItem";
import * as vscode from "vscode";
import { customRequest } from "./utils";
import { TreeItemProvider } from "./treeItemProvider";

export interface TreeItemProviderProxy {
    updateTraceLogs(threadId: number | undefined): Promise<undefined>;

    loadMoreTraceLogs(threadId: number): void;

    getPrevLogItem(selected: RdbgTreeItem): Promise<RdbgTreeItem | undefined>;

    getNextLogItem(selected: RdbgTreeItem): Promise<RdbgTreeItem | undefined>;

    createTree(): Promise<RdbgTreeItem[]>;

    selectLog(selected: RdbgTreeItem): Promise<void>;
}

export class RecordTreeItemProviderProxy implements TreeItemProviderProxy {
    private _recordTree: RecordLogTreeProvider | undefined;
    private curThreadId: number | undefined;
    private curStoppedIndex: number | undefined;

    constructor(private readonly _toggleItem: ToggleTreeItem) {}

    async updateTraceLogs(threadId: number | undefined) {
        const session = vscode.debug.activeDebugSession;
        if (session === undefined || threadId === undefined) return void 0;
        this.curThreadId = threadId;
        const args: RdbgRecordInspectorCollectArguments = {
            command: "record",
            subCommand: "collect",
            threadId: threadId,
        };
        const resp: RecordLogsResponse | undefined = await customRequest(session, rdbgTraceInspectorCmd, args);
        if (resp === undefined || resp.logs.length < 1) {
            return void 0;
        }
        this.curStoppedIndex = resp.stoppedIndex;
        if (resp.logs[this.curStoppedIndex]) {
            resp.logs[this.curStoppedIndex].stopped = true;
        }
        this._recordTree = new RecordLogTreeProvider(resp.logs);
    }
    loadMoreTraceLogs(_threadId: number): void {
        this._recordTree?.loadMoreLogs();
    }
    async selectLog(selected: RdbgTreeItem) {
        const session = vscode.debug.activeDebugSession;
        if (session === undefined || this.curThreadId === undefined || this.curStoppedIndex === undefined) return;

        let count = this.curStoppedIndex - (selected as RecordLogItem).index;
        let command: "step" | "stepBack";
        if (count > 0) {
            command = "stepBack";
        } else {
            command = "step";
            count = Math.abs(count);
        }
        const args: RdbgRecordInspectorPlayBackArguments = {
            subCommand: command,
            count,
            threadId: this.curThreadId,
            command: "record"
        };
        customRequest(session, rdbgTraceInspectorCmd, args);
    }
    async getPrevLogItem(selected: RdbgTreeItem) {
        if (!(selected instanceof LoadMoreItem) && !(selected instanceof OmittedItem) && this.curStoppedIndex) {
            selected = this._recordTree!.getLogItem(this.curStoppedIndex);
        }
        if (selected instanceof RecordLogItem || selected instanceof OmittedItem || selected instanceof LoadMoreItem) {
            return this._recordTree?.getPrevLogItem(selected);
        }
        return this._recordTree?.getBottomLogItem();
    }
    async getNextLogItem(selected: RdbgTreeItem) {
        if (!(selected instanceof LoadMoreItem) && !(selected instanceof OmittedItem) && this.curStoppedIndex) {
            selected = this._recordTree!.getLogItem(this.curStoppedIndex);
        }
        if (selected instanceof RecordLogItem || selected instanceof OmittedItem || selected instanceof LoadMoreItem) {
            return this._recordTree?.getNextLogItem(selected);
        }
        return this._recordTree?.getBottomLogItem();
    }
    async createTree() {
        const items: RdbgTreeItem[] = [];
        if (this._toggleItem !== undefined) {
            items.push(this._toggleItem);
        }
        if (this._recordTree === undefined) {
            return items;
        }
        const root = new RootLogItem("Record");
        items.push(root);
        if (this._recordTree === undefined) {
            return [];
        }
        const tree = await this._recordTree.createTree();
        this.setParentChild(tree, root);
        return items;
    }

    private async setParentChild(children: RdbgTreeItem[], parent: RdbgTreeItem) {
        parent.children = children;
        for (const child of children) {
            child.parent = parent;
        }
    }
}

class RecordLogTreeProvider extends TreeItemProvider {
    protected needLoading(item: RdbgTreeItem): boolean {
        return item.parent instanceof RootLogItem;
    }
    protected execLoadingCommand(threadId?: number | undefined): Thenable<void> {
        return vscode.commands.executeCommand("rdbg.inspector.loadMoreLogs", threadId);
    }
    protected newLoadMoreItem(_threadId?: number | undefined): LoadMoreItem {
        return new LoadMoreItem();
    }
    protected newLogItem(log: BaseLog, idx: number, state: vscode.TreeItemCollapsibleState): BaseLogItem {
        const record = log as RecordLog;
        let label: string | vscode.TreeItemLabel = record.name;
        if (record.stopped) {
            const name = "(Stopped): " + label;
            label = { label: name, highlights: [[0, name.length]] };
        }
        return new RecordLogItem(label, idx, record.depth, record.location, record.parameters, state);
    }
}

const rdbgTraceInspectorCmd = "rdbgTraceInspector";

export class TraceTreeItemProviderProxy implements TreeItemProviderProxy {
    private _traceTreeMap: Map<number, TraceLogTreeProvider>;
    private curThreadId: number | undefined;

    constructor(private readonly _toggleItem: ToggleTreeItem) {
        this._traceTreeMap = new Map<number, TraceLogTreeProvider>();
    }

    async updateTraceLogs(threadId: number | undefined) {
        const session = vscode.debug.activeDebugSession;
        if (session === undefined) return void 0;
        this.curThreadId = threadId;
        const args: RdbgTraceInspectorLogsArguments = {
            command: "trace",
            subCommand: "collect",
        };
        const resp: TraceLogsResponse | undefined = await customRequest(session, rdbgTraceInspectorCmd, args);
        if (resp === undefined || resp.logs.length < 1) {
            return void 0;
        }
        this._traceTreeMap = this.toTraceTreeMap(resp.logs);
    }

    private toTraceTreeMap(logs: TraceLog[]) {
        const treeMap = new Map<number, TraceLogTreeProvider>();
        const logMap = this.toTraceLogMap(logs);
        logMap.forEach((logs, threadId) => {
            treeMap.set(threadId, new TraceLogTreeProvider(logs, threadId));
        });
        return new Map([...treeMap].sort((a, b) => a[0] - b[0]));
    }

    private toTraceLogMap(logs: TraceLog[]) {
        const map = new Map<number, TraceLog[]>();
        for (const log of logs) {
            const value = map.get(log.threadId);
            if (value === undefined) {
                map.set(log.threadId, [log]);
            } else {
                value.push(log);
                map.set(log.threadId, value);
            }
        }
        return map;
    }

    loadMoreTraceLogs(threadId: number) {
        const provider = this._traceTreeMap.get(threadId);
        provider?.loadMoreLogs();
    }

    async selectLog(selected: RdbgTreeItem) {
        const location = (selected as TraceLogItem).location;
        const opts: vscode.TextDocumentShowOptions = {
            selection: new vscode.Range(location.line - 1, 0, location.line - 1, 0),
            preserveFocus: true,
        };
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(location.path), opts);
    }

    async getPrevLogItem(selected: RdbgTreeItem) {
        if ("threadId" in selected && typeof selected.threadId === "number") {
            const provider = this._traceTreeMap.get(selected.threadId);
            return provider?.getPrevLogItem(selected);
        }
    }

    async getNextLogItem(selected: RdbgTreeItem) {
        if ("threadId" in selected && typeof selected.threadId === "number") {
            const provider = this._traceTreeMap.get(selected.threadId);
            return provider?.getNextLogItem(selected);
        }
    }

    async createTree() {
        const items: RdbgTreeItem[] = [];
        if (this._toggleItem !== undefined) {
            items.push(this._toggleItem);
        }
        if (this._traceTreeMap.size > 0) {
            const root = new RootLogItem("Trace");
            items.push(root);
        }
        const stack = items.concat();
        while (true) {
            const item = stack.pop();
            if (item === undefined) {
                break;
            }
            let children: RdbgTreeItem[] = [];
            switch (true) {
                case item instanceof ThreadIdItem:
                    const tIdItem = item as ThreadIdItem;
                    const provider = this._traceTreeMap.get(tIdItem.threadId);
                    if (provider === undefined) {
                        return [];
                    }
                    const tree = await provider.createTree();
                    children = tree;
                    this.setParentChild(children, item);
                    break;
                case item instanceof RootLogItem:
                    for (const threadId of this._traceTreeMap.keys()) {
                        const item = new ThreadIdItem(threadId);
                        if (threadId === this.curThreadId) {
                            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                        }
                        children.push(item);
                    }
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

    private async setParentChild(children: RdbgTreeItem[], parent: RdbgTreeItem) {
        parent.children = children;
        for (const child of children) {
            child.parent = parent;
        }
    }
}

class TraceLogTreeProvider extends TreeItemProvider {
    protected needLoading(item: RdbgTreeItem): boolean {
        return item.parent instanceof ThreadIdItem;
    }
    protected execLoadingCommand(threadId?: number | undefined): Thenable<void> {
        return vscode.commands.executeCommand("rdbg.inspector.loadMoreLogs", threadId);
    }
    protected newLoadMoreItem(threadId?: number): LoadMoreItem {
        return new LoadMoreItem(threadId);
    }
    protected newLogItem(log: BaseLog, idx: number, state: vscode.TreeItemCollapsibleState): BaseLogItem {
        const trace = log as TraceLog;
        if (trace.name) {
            return new CallTraceLogItem(trace, idx, state);
        }
        return new LineTraceLogItem(trace, idx, state);
    }
}
