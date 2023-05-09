import * as vscode from "vscode";
import {
    BaseLogItem,
    CallTraceLogItem,
    LineTraceLogItem,
    RdbgTreeItem,
    RecordLogItem,
    RootLogItem,
    ToggleTreeItem,
} from "./rdbgTreeItem";
import { BaseLog, RdbgInspectorConfig } from "./protocol";
import { RecordTreeItemProviderProxy, TraceTreeItemProviderProxy, TreeItemProviderProxy } from "./treeItemProxy";
import { VersionChecker } from "./utils";
import { LaunchConfiguration } from "./config";
import { DebugProtocol } from "@vscode/debugprotocol";

export function registerInspectorView(emitter: vscode.EventEmitter<any>, versionChecker: VersionChecker) {
    const config: RdbgInspectorConfig = {
        traceLine: true,
        traceCall: true,
        traceClanguageCall: true,
        recordAndReplay: true,
    };
    const treeProvider = new RdbgTraceInspectorTreeProvider(config);
    const view = vscode.window.createTreeView("rdbg.inspector", { treeDataProvider: treeProvider });
    const inlayHintsProvider = new RdbgCodeLensProvider(view);
    const disposables: vscode.Disposable[] = [];
    let traceInspectorEnabled: boolean | undefined;
    // Since it takes time to get vscode.debug.activeDebugSession,
    // we holds the session obtained in DebugAdapterDescriptorFactory#createDebugAdapterDescriptor.
    let activeSession: vscode.DebugSession | undefined;

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

        emitter.event(async (message) => {
            switch (true) {
                case message.event === "stopped":
                    while (traceInspectorEnabled === undefined) {
                        await new Promise((resolve) => setTimeout(resolve, 10));
                    }
                    if (!traceInspectorEnabled) {
                        return;
                    }
                    const evt = message as DebugProtocol.StoppedEvent;
                    treeProvider.updateTraceLogs(evt.body.threadId);
                    break;
                case treeProvider.toggleTreeItem.enabled &&
                    (message.command === "launch" || message.command === "attach"):
                    while (traceInspectorEnabled === undefined) {
                        await new Promise((resolve) => setTimeout(resolve, 1));
                    }
                    if (!traceInspectorEnabled) {
                        return;
                    }
                    await treeProvider.toggleTreeItem.enable(activeSession);
                    break;
            }
        }),

        vscode.debug.onDidTerminateDebugSession(async () => {
            traceInspectorEnabled = undefined;
            treeProvider.cleanUp();
        }),

        // rdbg.inspector.startDebugSession is defined to check the version of debug.gem. To send the request to enable Trace Inspector as soon as possible, we need to finish checking the version of debug.gem in advance.
        vscode.commands.registerCommand("rdbg.inspector.startDebugSession", async (session: vscode.DebugSession) => {
            const traceEnabled = vscode.workspace.getConfiguration("rdbg").get<boolean>("enableTraceInspector");
            if (!traceEnabled) {
                if (treeProvider.toggleTreeItem.enabled) {
                    vscode.window.showErrorMessage(
                        "Trace Inpsector failed to start because enableTraceInspector field is false. Please set it to true",
                    );
                    await treeProvider.toggleTreeItem.resetView();
                    treeProvider.refresh();
                }
                traceInspectorEnabled = false;
                return;
            }
            activeSession = session;
            const config = session.configuration as LaunchConfiguration;
            traceInspectorEnabled = await validVersion(config, versionChecker, treeProvider);
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
                await view.reveal(log, { select: true });
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
                await view.reveal(log, { select: true });
            }
        }),

        vscode.commands.registerCommand("rdbg.inspector.toggle", async () => {
            // When traceInspectorEnabled is undefined, debug session is not started. We can enable trace inspector in this case.
            if (traceInspectorEnabled === false) {
                vscode.window.showErrorMessage(
                    "Trace Inpsector failed to start because of the version of debug.gem was less than 1.8.0. Please update the version.",
                );
                return;
            }
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

        vscode.commands.registerCommand("rdbg.inspector.enableTraceClanguageCall", () => {
            config.traceClanguageCall = true;
            vscode.commands.executeCommand("setContext", "traceClanguageCallEnabled", true);
        }),

        vscode.commands.registerCommand("rdbg.inspector.disableTraceClanguageCall", () => {
            config.traceClanguageCall = false;
            vscode.commands.executeCommand("setContext", "traceClanguageCallEnabled", false);
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

        vscode.commands.registerCommand("rdbg.inspector.copyLog", (log: BaseLog) => {
            const fields = getLogFields(log);
            const json = JSON.stringify(fields);
            vscode.env.clipboard.writeText(json);
        }),
    );

    vscode.commands.executeCommand("setContext", "traceInspectorEnabled", true);
    vscode.commands.executeCommand("rdbg.inspector.disableRecordAndReplay");
    vscode.commands.executeCommand("rdbg.inspector.disableTraceClanguageCall");
    vscode.commands.executeCommand("rdbg.inspector.enableTraceLine");
    vscode.commands.executeCommand("rdbg.inspector.enableTraceCall");
    vscode.commands.executeCommand("setContext", "filterEntered", false);

    return disposables;
}

async function validVersion(
    config: LaunchConfiguration,
    versionChecker: VersionChecker,
    treeProvider: RdbgTraceInspectorTreeProvider,
) {
    const str = await versionChecker.getVersion(config);
    if (str === null) {
        vscode.window.showErrorMessage("Trace Inpsector failed to start because of failing to check version");
        return false;
    }
    const version = versionChecker.vernum(str);
    // checks the version of debug.gem is 1.8.0 or higher.
    if (version < 1008000) {
        if (treeProvider.toggleTreeItem.enabled) {
            await treeProvider.toggleTreeItem.resetView();
            treeProvider.refresh();
            vscode.window.showErrorMessage(
                "Trace Inpsector failed to start because of the version of debug.gem was less than 1.8.0. Please update the version.",
            );
        }
        return false;
    }
    return true;
}

function getLogFields(log: BaseLog) {
    switch (true) {
        case log instanceof CallTraceLogItem:
            const call = log as CallTraceLogItem;
            return {
                method: call.label,
                location: call.location,
                returnValue: call.returnValue,
                parameters: call.parameters,
            };
        case log instanceof LineTraceLogItem:
            return {
                location: log.location,
            };
        case log instanceof RecordLogItem:
            const record = log as RecordLogItem;
            return {
                method: record.label,
                location: log.location,
                parameters: record.parameters,
            };
        default:
            throw new Error("Invalid log type");
    }
}

class RdbgTraceInspectorTreeProvider implements vscode.TreeDataProvider<RdbgTreeItem> {
    private _toggleItem: ToggleTreeItem;
    providerProxy: TreeItemProviderProxy | undefined;

    constructor(config: RdbgInspectorConfig) {
        this._toggleItem = new ToggleTreeItem(config);
        this.refresh();
    }

    cleanUp() {
        this.providerProxy?.cleanUp();
        this.providerProxy = undefined;
        if (this._toggleItem.enabled) {
            this._toggleItem.toggle();
        }
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
        if (session === undefined || this.providerProxy === undefined) return [this.toggleTreeItem];

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
                    title: this.truncateString(label),
                    command: "",
                    tooltip: label,
                    arguments: [item, codeLens.range],
                };
            }
            if (item.parameters) {
                const label = this.createCallEventTitle(item);
                codeLens.command = {
                    title: this.truncateString(label),
                    tooltip: label,
                    command: "",
                    arguments: [item, codeLens.range],
                };
            }
        } else if (item instanceof RecordLogItem) {
            if (item.parameters) {
                const label = this.createCallEventTitle(item);
                codeLens.command = {
                    title: this.truncateString(label),
                    tooltip: label,
                    command: "",
                    arguments: [item, codeLens.range],
                };
            }
        }
        return codeLens;
    }
    private createCallEventTitle(item: CallTraceLogItem | RecordLogItem) {
        if (item.parameters === undefined) {
            throw new Error("");
        }
        let params = "";
        for (const param of item.parameters) {
            params += `${param.name} = ${param.value}, `;
        }
        let methodName = item.label;
        if (item.label instanceof Object) {
            methodName = item.label.label;
        }
        return `${methodName}(${params.slice(0, params.length - 2)})`;
    }
    private truncateString(str: string) {
        if (str.length > 99) {
            return str.substring(0, 99) + "...";
        }
        return str;
    }
    refresh() {
        this._onDidChangeCodeLenses.fire();
    }
}
