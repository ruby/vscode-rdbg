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

    getPrevLogItem(selected: RdbgTreeItem): Promise<RdbgTreeItem | undefined>;

    getNextLogItem(selected: RdbgTreeItem): Promise<RdbgTreeItem | undefined>;

    createTree(): Promise<RdbgTreeItem[]>;

    selectLog(selected: RdbgTreeItem): Promise<void>;

    cleanUp(): void;
}

export class RecordTreeItemProviderProxy implements TreeItemProviderProxy {
    private _recordTree: RecordLogTreeProvider | undefined;
    private curThreadId: number | undefined;
    private curStoppedIndex: number | undefined;

    constructor(private readonly _toggleItem: ToggleTreeItem) {}

    cleanUp(): void {}

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
            command: "record",
        };
        customRequest(session, rdbgTraceInspectorCmd, args);
    }
    async getPrevLogItem(selected: RdbgTreeItem) {
        if (!(selected instanceof OmittedItem) && this.curStoppedIndex) {
            selected = this._recordTree!.getLogItem(this.curStoppedIndex);
        }
        if (selected instanceof RecordLogItem || selected instanceof OmittedItem) {
            return this._recordTree?.getPrevLogItem(selected);
        }
        return this._recordTree?.getBottomLogItem();
    }
    async getNextLogItem(selected: RdbgTreeItem) {
        if (!(selected instanceof OmittedItem) && this.curStoppedIndex) {
            selected = this._recordTree!.getLogItem(this.curStoppedIndex);
        }
        if (selected instanceof RecordLogItem || selected instanceof OmittedItem) {
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
    protected newLogItem(log: BaseLog, idx: number, state: vscode.TreeItemCollapsibleState): BaseLogItem {
        const record = log as RecordLog;
        let label: string | vscode.TreeItemLabel = record.name;
        if (record.stopped) {
            const name = "(Stopped): " + label;
            label = { label: name, highlights: [[0, name.length]] };
        }
        return new RecordLogItem(label, record, idx, state);
    }
}

const rdbgTraceInspectorCmd = "rdbgTraceInspector";

export class TraceTreeItemProviderProxy implements TreeItemProviderProxy {
    private _traceTreeMap: Map<number, TraceLogTreeProvider>;
    private curThreadId: number | undefined;
    private decorationType: vscode.TextEditorDecorationType;

    cleanUp(): void {
        this.decorationType.dispose();
    }

    constructor(private readonly _toggleItem: ToggleTreeItem) {
        this._traceTreeMap = new Map<number, TraceLogTreeProvider>();
        this.decorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: new vscode.ThemeColor("editorInlayHint.background"),
        });
    }

    async updateTraceLogs(threadId: number | undefined) {
        const session = vscode.debug.activeDebugSession;
        if (session === undefined) return void 0;
        if (threadId !== undefined) {
            this.curThreadId = threadId;
        }
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

    async selectLog(selected: RdbgTreeItem) {
        const location = (selected as TraceLogItem).location;
        const range = new vscode.Range(location.line - 1, 0, location.line - 1, 0);
        const opts: vscode.TextDocumentShowOptions = {
            selection: range,
            preserveFocus: true,
        };
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(location.path), opts);
        if (vscode.window.activeTextEditor) {
            vscode.window.activeTextEditor.setDecorations(this.decorationType, [range]);
        }
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
        return this.collapseLastItems(items);
    }

    private async collapseLastItems(items: RdbgTreeItem[]) {
        if (items.length === 1) {
            return items;
        }
        const stack = [items[items.length - 1]];
        while (true) {
            const item = stack.pop();
            if (item === undefined) {
                break;
            }
            if (item.children && item.children.length > 0) {
                switch (true) {
                    case item instanceof BaseLogItem:
                        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                        stack.push(...item.children);
                        break;
                    case item instanceof ThreadIdItem:
                        const thread = item as ThreadIdItem;
                        if (thread.threadId === this.curThreadId) {
                            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                            stack.push(item.children[item.children.length - 1]);
                        }
                        break;
                    default:
                        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                        stack.push(...item.children);
                        break;
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
    protected newLogItem(log: BaseLog, idx: number, state: vscode.TreeItemCollapsibleState): BaseLogItem {
        const trace = log as TraceLog;
        if (trace.name) {
            return new CallTraceLogItem(trace, idx, state);
        }
        return new LineTraceLogItem(trace, idx, state);
    }
}
