export interface Location {
	path: string;
	line: number;
}

type InspectorBaseCommands = "enable" | "disable" | "collect";

export interface RdbgTraceInspectorArguments {
	command:  InspectorBaseCommands;
}

export type TraceEventKind = "line" | "call" | "return";

export interface TraceEventKindState {
	line: boolean;
	call: boolean;
	return: boolean;
}

export interface RdbgTraceInspectorEnableArguments extends RdbgTraceInspectorArguments {
	command: "enable";
	events: TraceEventKind[];
}

export interface RdbgTraceInspectorDisableArguments extends RdbgTraceInspectorArguments {
	command: "disable";
}

export interface RdbgTraceInspectorLogsArguments extends RdbgTraceInspectorArguments {
	command: "collect";
}

export interface TraceLogsResponse {
	logs: TraceLog[];
}

export interface TraceLog extends BaseLog {
	hasChild?: boolean;
	name?: string;
	threadId: number;
	returnValue?: string;
	index: number;
}

export interface RdbgRecordInspectorArguments {
	command:  InspectorBaseCommands | "step" | "stepBack";
}

export interface RdbgRecordInspectorEnableArguments extends RdbgRecordInspectorArguments {
	command: "enable";
}

export interface RdbgRecordInspectorDisableArguments extends RdbgRecordInspectorArguments {
	command: "disable";
}

export interface RdbgRecordInspectorCollectArguments extends RdbgRecordInspectorArguments {
	command: "collect";
	threadId: number;
}

export interface RdbgRecordInspectorPlayBackArguments extends RdbgRecordInspectorArguments {
	command: "step" | "stepBack";
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
	location: Location;
	depth: number;
}
