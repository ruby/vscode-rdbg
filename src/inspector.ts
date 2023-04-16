import * as vscode from "vscode";
import {
    BaseLogItem,
    CallTraceLogItem,
    RdbgTreeItem,
    RecordLogItem,
    RootLogItem,
    ToggleTreeItem,
} from "./rdbgTreeItem";
import { RdbgInspectorConfig } from "./protocol";
import { RdbgDecorationProvider } from "./utils";
import { RecordTreeItemProviderProxy, TraceTreeItemProviderProxy, TreeItemProviderProxy } from "./treeItemProxy";

export function registerInspectorView(emitter: vscode.EventEmitter<number | undefined>) {
    const config: RdbgInspectorConfig = {
        traceLine: true,
        traceCall: true,
        recordAndReplay: true,
    };
    const treeProvider = new RdbgTraceInspectorTreeProvider(config);
    const view = vscode.window.createTreeView("rdbg.inspector", { treeDataProvider: treeProvider });
    const inlayHintsProvider = new RdbgCodeLensProvider(view);
    const disposables: vscode.Disposable[] = [];
    const disp = RdbgDecorationProvider.create();
    if (disp) {
        disposables.push(disp);
    }

    disposables.push(
        vscode.languages.registerCodeLensProvider(
            [
                {
                    language: "ruby",
                },
                {
                    language: "haml",
                },
                {
                    language: "slim",
                },
            ],
            inlayHintsProvider,
        ),

        emitter.event((threadId) => {
            if (treeProvider.toggleTreeItem.enabled) {
                treeProvider.updateTraceLogs(threadId);
            }
        }),

        vscode.debug.onDidTerminateDebugSession(async () => {
            vscode.commands.executeCommand("setContext", "traceInspectorEnabled", false);
            treeProvider.cleanUp();
        }),

        vscode.commands.registerCommand("rdbg.inspector.openPrevLog", async () => {
            switch (true) {
                case view.selection.length < 1:
                case view.selection[0] instanceof ToggleTreeItem:
                case view.selection[0] instanceof RootLogItem:
                    return;
            }
            const log = await treeProvider.getPrevLogItem(view.selection[0]);
            if (log !== undefined) {
                await view.reveal(log, { select: true, expand: 3 });
            }
        }),

        vscode.commands.registerCommand("rdbg.inspector.openNextLog", async () => {
            switch (true) {
                case view.selection.length < 1:
                case view.selection[0] instanceof ToggleTreeItem:
                case view.selection[0] instanceof RootLogItem:
                    return;
            }
            const log = await treeProvider.getNextLogItem(view.selection[0]);
            if (log !== undefined) {
                await view.reveal(log, { select: true, expand: 3 });
            }
        }),

        vscode.commands.registerCommand("rdbg.inspector.loadMoreLogs", (threadId) => {
            treeProvider.loadMoreTraceLogs(threadId);
        }),

        vscode.commands.registerCommand("rdbg.inspector.toggle", async () => {
            const item = treeProvider.toggleTreeItem;
            await item.toggle();
            if (item.enabled) {
                if (config.recordAndReplay) {
                    treeProvider.providerProxy = new RecordTreeItemProviderProxy(item);
                } else {
                    treeProvider.providerProxy = new TraceTreeItemProviderProxy(item);
                }
            }
            treeProvider.refresh();
        }),

        vscode.commands.registerCommand("rdbg.inspector.disableTraceLine", () => {
            config.traceLine = false;
            vscode.commands.executeCommand("setContext", "traceLineEnabled", false);
            vscode.commands.executeCommand("rdbg.inspector.disableRecordAndReplay");
        }),

        vscode.commands.registerCommand("rdbg.inspector.enableTraceLine", () => {
            config.traceLine = true;
            vscode.commands.executeCommand("setContext", "traceLineEnabled", true);
        }),

        vscode.commands.registerCommand("rdbg.inspector.disableTraceCall", () => {
            config.traceCall = false;
            vscode.commands.executeCommand("setContext", "traceCallEnabled", false);
        }),

        vscode.commands.registerCommand("rdbg.inspector.enableTraceCall", () => {
            config.traceCall = true;
            vscode.commands.executeCommand("setContext", "traceCallEnabled", true);
        }),

        vscode.commands.registerCommand("rdbg.inspector.disableRecordAndReplay", () => {
            config.recordAndReplay = false;
            vscode.commands.executeCommand("setContext", "recordAndReplayEnabled", false);
        }),

        vscode.commands.registerCommand("rdbg.inspector.enableRecordAndReplay", () => {
            config.recordAndReplay = true;
            vscode.commands.executeCommand("setContext", "recordAndReplayEnabled", true);
        }),

        vscode.commands.registerCommand("rdbg.inspector.enterFilter", async () => {
            const opts: vscode.InputBoxOptions = {
                placeHolder: "e.g. foobar.*",
            };
            if (config.filterRegExp) {
                opts.value = config.filterRegExp;
            }
            const input = await vscode.window.showInputBox(opts);
            if (input === undefined || input.length < 1) {
                vscode.commands.executeCommand("setContext", "filterEntered", false);
                config.filterRegExp = undefined;
                return;
            }
            const result = input.match(/^\/(.+)\/$/);
            if (result && result.length === 2) {
                config.filterRegExp = result[1];
            } else {
                config.filterRegExp = input;
            }
            vscode.commands.executeCommand("setContext", "filterEntered", true);
        }),

        vscode.commands.registerCommand("rdbg.inspector.reenterFilter", () => {
            vscode.commands.executeCommand("rdbg.inspector.enterFilter");
        }),

        view.onDidChangeSelection((e) => {
            if (e.selection.length < 1) {
                return;
            }
            if (e.selection[0] instanceof BaseLogItem) {
                treeProvider.selectLog(e.selection[0]);
                inlayHintsProvider.refresh();
            }
        }),
    );

    vscode.commands.executeCommand("setContext", "traceInspectorEnabled", true);
    vscode.commands.executeCommand("rdbg.inspector.disableRecordAndReplay");
    vscode.commands.executeCommand("rdbg.inspector.enableTraceLine");
    vscode.commands.executeCommand("rdbg.inspector.enableTraceCall");
    vscode.commands.executeCommand("setContext", "filterEntered", false);

    return disposables;
}

class RdbgTraceInspectorTreeProvider implements vscode.TreeDataProvider<RdbgTreeItem> {
    private _toggleItem: ToggleTreeItem;
    providerProxy: TreeItemProviderProxy | undefined;

    constructor(config: RdbgInspectorConfig) {
        this._toggleItem = new ToggleTreeItem(config);
        this.refresh();
    }

    cleanUp() {
        this.providerProxy = undefined;
        this.refresh();
    }

    get toggleTreeItem() {
        return this._toggleItem;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    async updateTraceLogs(threadId: number | undefined) {
        await this.providerProxy?.updateTraceLogs(threadId);
        this.refresh();
    }

    loadMoreTraceLogs(threadId: number) {
        this.providerProxy?.loadMoreTraceLogs(threadId);
        this.refresh();
    }

    async getPrevLogItem(selected: RdbgTreeItem) {
        return this.providerProxy?.getPrevLogItem(selected);
    }

    async getNextLogItem(selected: RdbgTreeItem) {
        return this.providerProxy?.getNextLogItem(selected);
    }

    selectLog(selected: RdbgTreeItem) {
        this.providerProxy?.selectLog(selected);
    }

    private _onDidChangeTreeData: vscode.EventEmitter<RdbgTreeItem | undefined | null | void> = new vscode.EventEmitter<
        RdbgTreeItem | undefined | null | void
    >();
    readonly onDidChangeTreeData: vscode.Event<RdbgTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;
    getTreeItem(element: RdbgTreeItem): RdbgTreeItem {
        return element;
    }

    async getChildren(element?: RdbgTreeItem): Promise<RdbgTreeItem[] | undefined> {
        const session = vscode.debug.activeDebugSession;
        if (session === undefined) return void 0;
        if (this.providerProxy === undefined) return [this._toggleItem];

        if (element) {
            return element.children;
        }
        // Do not await
        return this.providerProxy.createTree();
    }

    async getParent(element: RdbgTreeItem): Promise<RdbgTreeItem | null | undefined> {
        const session = vscode.debug.activeDebugSession;
        if (session === undefined) return void 0;

        return element.parent;
    }
}

class RdbgCodeLensProvider implements vscode.CodeLensProvider {
    private readonly _singleSpace = " ";
    private readonly _arrow = "#=>";
    private curItem: BaseLogItem | undefined;
    constructor(private readonly _treeView: vscode.TreeView<RdbgTreeItem>) {}
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;
    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        if (this._treeView.selection.length < 1) {
            return codeLenses;
        }
        const codeLens = this.getCodeLens(this._treeView.selection[0], document);
        if (codeLens) {
            codeLenses.push(codeLens);
        }
        return codeLenses;
    }
    private getCodeLens(item: RdbgTreeItem, document: vscode.TextDocument) {
        switch (true) {
            case item instanceof CallTraceLogItem:
                const call = item as CallTraceLogItem;
                if (call.returnValue !== undefined) {
                    return this.newCodeLens(call, document);
                }
                if (call.parameters !== undefined) {
                    return this.newCodeLens(call, document);
                }
            case item instanceof RecordLogItem:
                const record = item as RecordLogItem;
                if (record.parameters !== undefined) {
                    return this.newCodeLens(record, document);
                }
        }
    }
    private newCodeLens(item: BaseLogItem, document: vscode.TextDocument) {
        const line = item.location.line - 1;
        const text = document.lineAt(line);
        this.curItem = item;
        return new vscode.CodeLens(text.range);
    }
    resolveCodeLens(
        codeLens: vscode.CodeLens,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.CodeLens> {
        const item = this.curItem;
        if (item === undefined) {
            return null;
        }
        if (item instanceof CallTraceLogItem) {
            if (item.returnValue !== undefined) {
                const label = item.label + this._singleSpace + this._arrow + this._singleSpace + item.returnValue;
                codeLens.command = {
                    title: label,
                    command: "",
                    arguments: [item, codeLens.range],
                };
            }
            if (item.parameters) {
                let label = "";
                for (const param of item.parameters) {
                    label += this._singleSpace + param.name + " = " + param.value;
                }
                codeLens.command = {
                    title: label,
                    command: "",
                    arguments: [item, codeLens.range],
                };
            }
        } else if (item instanceof RecordLogItem) {
            if (item.parameters) {
                let label = "";
                for (const param of item.parameters) {
                    label += this._singleSpace + param.name + " = " + param.value;
                }
                codeLens.command = {
                    title: label,
                    command: "",
                    arguments: [item, codeLens.range],
                };
            }
        }
        return codeLens;
    }
    refresh() {
        this._onDidChangeCodeLenses.fire();
    }
}
