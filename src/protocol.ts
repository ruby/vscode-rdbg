export interface Location {
    path: string;
    line: number;
}

type RdbgInspectorBaseSubCommands = "enable" | "disable" | "collect";

export type RdbgInspectorCommand = "record" | "trace";

export interface RdbgTraceInspectorArguments {
    command: RdbgInspectorCommand;
    subCommand: RdbgInspectorBaseSubCommands;
}

export type TraceEventKind =
    | "traceLine"
    | "traceCall"
    | "traceReturn"
    | "traceParams"
    | "traceClanguageReturn"
    | "traceClanguageCall";

export interface RdbgInspectorConfig {
    traceLine: boolean;
    traceCall: boolean;
    traceClanguageCall: boolean;
    recordAndReplay: boolean;
    filterRegExp?: string;
}

export interface RdbgInspectorEnableArguments extends RdbgTraceInspectorArguments {
    subCommand: "enable";
    events?: TraceEventKind[];
    filterRegExp?: string;
    maxLogSize: number;
}

export interface RdbgInspectorDisableArguments extends RdbgTraceInspectorArguments {
    subCommand: "disable";
}

export interface RdbgTraceInspectorLogsArguments extends RdbgTraceInspectorArguments {
    subCommand: "collect";
}

export interface TraceLogsResponse {
    logs: TraceLog[];
}

export interface TraceLog extends BaseLog {
    hasChild?: boolean;
    threadId: number;
    index: number;
}

export interface RdbgRecordInspectorArguments {
    command: RdbgInspectorCommand;
    subCommand: RdbgInspectorBaseSubCommands | "step" | "stepBack";
}

export interface RdbgRecordInspectorCollectArguments extends RdbgRecordInspectorArguments {
    subCommand: "collect";
    threadId: number;
}

export interface RdbgRecordInspectorPlayBackArguments extends RdbgRecordInspectorArguments {
    subCommand: "step" | "stepBack";
    threadId: number;
    count: number;
}

export interface RecordLogsResponse {
    stoppedIndex: number;
    logs: RecordLog[];
}

export interface RecordLog extends BaseLog {
    name: string;
    // This field is filled in the vscode-rdbg.
    stopped?: boolean;
}

export interface BaseLog {
    name?: string;
    location: Location;
    depth: number;
    returnValue?: string;
    parameters?: { name: string; value: string }[];
}
