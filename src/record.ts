import * as vscode from "vscode";
import {
  BaseLogItem,
  LoadMoreItem,
  OmittedItem,
  RdbgTreeItem,
  RdbgTreeItemOptions,
  RootLogItem,
  ToggleTreeItem,
} from "./rdbgTreeItem";
import {
  RecordLogsResponse,
  RecordLog,
  RdbgRecordInspectorCollectArguments,
  RdbgRecordInspectorDisableArguments,
  RdbgRecordInspectorEnableArguments,
  BaseLog,
  RdbgRecordInspectorPlayBackArguments,
} from "./protocol";
import { customRequest, RdbgDecorationProvider } from "./utils";
import { Location } from "./protocol";
import { TreeItemProvider } from "./treeItemProvider";

const rdbgRecordInspectorCmd = "rdbgRecordInspector";

export function registerRecordProvider(emitter: vscode.EventEmitter<number | undefined>) {
  const treeProvider = new RdbgRecordInspectorTreeProvider();
  const view = vscode.window.createTreeView("rdbg.record", { treeDataProvider: treeProvider });
  const disposables: vscode.Disposable[] = [];

  const disp = RdbgDecorationProvider.create();
  if (disp) {
    disposables.push(disp);
  }

  disposables.push(
    emitter.event((threadId) => {
      if (treeProvider.toggleTreeItem?.enabled) {
				treeProvider.updateRecordLogs(threadId);
			}
    }),

    vscode.debug.onDidTerminateDebugSession(async () => {
      vscode.commands.executeCommand("setContext", "recordInspectorEnabled", false);
      treeProvider.cleanUp();
    }),

    vscode.commands.registerCommand("rdbg.record.openPrevLog", async () => {
      const log = await treeProvider.getPrevLogItem(view.selection[0]);
      if (log !== undefined) {
        await view.reveal(log, { select: true, expand: 3 });
      }
    }),

    vscode.commands.registerCommand("rdbg.record.openNextLog", async () => {
      const log = treeProvider.getNextLogItem(view.selection[0]);
      if (log !== undefined) {
        await view.reveal(log, { select: true, expand: 3 });
      }
    }),

    vscode.commands.registerCommand("rdbg.record.loadMoreLogs", () => {
      treeProvider.loadMoreRecordLogs();
    }),

    vscode.commands.registerCommand("rdbg.record.toggle", async () => {
      const item = treeProvider.toggleTreeItem;
      if (item === undefined) {
        return;
      }
      await item.toggle();
      treeProvider.refresh();
    }),

    view.onDidChangeSelection(async (e) => {
      if (e.selection.length < 1) {
        return;
      }
      if (e.selection[0] instanceof RecordLogItem) {
        treeProvider.playBack(e.selection[0]);
      }
    }),
  );

  vscode.commands.executeCommand("setContext", "recordInspectorEnabled", true);
  treeProvider.initTreeView();

  return disposables;
}

class RdbgRecordInspectorTreeProvider implements vscode.TreeDataProvider<RdbgTreeItem> {
  private _recordTree: RecordLogTreeProvider | undefined;
  private _toggleItem: RecordToggleTreeItem | undefined;
  private curThreadId: number | undefined;
  private curStoppedIndex: number | undefined;

  cleanUp() {
    this._recordTree = undefined;
    this.refresh();
  }

  get toggleTreeItem() {
    return this._toggleItem;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  async updateRecordLogs(threadId: number | undefined) {
    const session = vscode.debug.activeDebugSession;
    if (session === undefined || threadId === undefined) return [];
    this.curThreadId = threadId;
    const args: RdbgRecordInspectorCollectArguments = {
      command: "collect",
      threadId: threadId,
    };
    const resp: RecordLogsResponse | undefined = await customRequest(session, rdbgRecordInspectorCmd, args);
    if (resp === undefined || resp.logs.length < 1) {
      return [];
    }
    this.curStoppedIndex = resp.stoppedIndex;
    if (resp.logs[this.curStoppedIndex]) {
      resp.logs[this.curStoppedIndex].stopped = true;
    }
    this._recordTree = new RecordLogTreeProvider(resp.logs);
    this.refresh();
  }

  playBack(item: RecordLogItem) {
    const session = vscode.debug.activeDebugSession;
    if (session === undefined || this.curThreadId === undefined || this.curStoppedIndex === undefined) return;

    let count = this.curStoppedIndex - item.index;
    let command: "step" | "stepBack";
    if (count > 0) {
      command = "stepBack";
    } else {
      command = "step";
      count = Math.abs(count);
    }
    const args: RdbgRecordInspectorPlayBackArguments = {
      command,
      count,
      threadId: this.curThreadId,
    };
    customRequest(session, rdbgRecordInspectorCmd, args);
    return;
  }

  loadMoreRecordLogs() {
    this._recordTree?.loadMoreLogs();
    this.refresh();
  }

  getPrevLogItem(selected: RdbgTreeItem | undefined) {
		if (!(selected instanceof LoadMoreItem) && !(selected instanceof OmittedItem) && this.curStoppedIndex) {
			selected = this._recordTree?.getLogItem(this.curStoppedIndex);
		}
    if (selected instanceof RecordLogItem || selected instanceof OmittedItem || selected instanceof LoadMoreItem) {
			return this._recordTree?.getPrevLogItem(selected);
    }
    return this._recordTree?.getBottomLogItem();
  }

  getNextLogItem(selected: RdbgTreeItem | undefined) {
    if (!(selected instanceof LoadMoreItem) && !(selected instanceof OmittedItem) && this.curStoppedIndex) {
			selected = this._recordTree?.getLogItem(this.curStoppedIndex);
		}
    if (selected instanceof RecordLogItem || selected instanceof OmittedItem || selected instanceof LoadMoreItem) {
			return this._recordTree?.getNextLogItem(selected);
    }
    return this._recordTree?.getBottomLogItem();
  }

  initTreeView() {
    this._toggleItem = new RecordToggleTreeItem();
    this.refresh();
  }

  private _onDidChangeTreeData: vscode.EventEmitter<RdbgTreeItem | undefined | null | void> = new vscode.EventEmitter<
    RdbgTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<RdbgTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  getTreeItem(element: RdbgTreeItem): RdbgTreeItem {
    return element;
  }

  async getChildren(element?: RdbgTreeItem): Promise<RdbgTreeItem[] | undefined> {
    const session = vscode.debug.activeDebugSession;
    if (session === undefined) return [];

    if (element) {
      return element.children;
    }
    // Do not await
    return this.createTree();
  }

  private async createTree() {
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

  async getParent(element: RdbgTreeItem): Promise<RdbgTreeItem | null | undefined> {
    const session = vscode.debug.activeDebugSession;
    if (session === undefined) return void 0;

    return element.parent;
  }
}

class RecordLogTreeProvider extends TreeItemProvider {
  protected needLoading(item: RdbgTreeItem): boolean {
    return item.parent instanceof RootLogItem;
  }
  protected execLoadingCommand(threadId?: number | undefined): Thenable<void> {
    return vscode.commands.executeCommand("rdbg.record.loadMoreLogs", threadId);
  }
  protected newLoadMoreItem(_threadId?: number | undefined): LoadMoreItem {
    return new RecordLoadMoreItem();
  }
  protected newLogItem(log: BaseLog, idx: number, state: vscode.TreeItemCollapsibleState): BaseLogItem {
    const record = log as RecordLog;
    let label: string | vscode.TreeItemLabel = record.name;
    if (record.stopped) {
      const name = "(Stopped): " + label;
      label = { label: name, highlights: [[0, name.length]] };
    }
    return new RecordLogItem(label, idx, record.depth, record.location, state);
  }
}

class RecordLoadMoreItem extends LoadMoreItem {
  constructor() {
    super("record");
  }
}

class RecordToggleTreeItem extends ToggleTreeItem {
  constructor() {
    super("Start Record", "record");
  }

  async disable(session: vscode.DebugSession) {
    super.enable(session);
    this.label = "Start Record";
    const args: RdbgRecordInspectorDisableArguments = {
      command: "disable",
    };
    await customRequest(session, "rdbgRecordInspector", args);
  }

  async enable(session: vscode.DebugSession) {
    super.enable(session);
    this.label = "Stop Record";
    const args: RdbgRecordInspectorEnableArguments = {
      command: "enable",
    };
    await customRequest(session, "rdbgRecordInspector", args);
  }
}

class RecordLogItem extends BaseLogItem {
  constructor(
    label: string | vscode.TreeItemLabel,
    public readonly index: number,
    public readonly depth: number,
    public readonly location: Location,
    state: vscode.TreeItemCollapsibleState,
    opts: RdbgTreeItemOptions = {},
  ) {
    const description = location.path + ":" + location.line;
    opts.collapsibleState = state;
    opts.description = description;
    super(label, index, depth, location, opts);
		this.id = index.toString();
  }
}
