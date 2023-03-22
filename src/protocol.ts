export interface Location {
	path: string;
	line: number;
}

export interface RdbgTraceInspectorArguments {
	command: "enable" | "disable" | "collect";
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

export interface TraceLog {
	hasChild?: boolean;
	location: Location;
	name?: string;
	depth: number;
	threadId: number;
	returnValue?: string;
	index: number;
}
