export interface Location {
	path: string;
	line: number;
}

export interface RdbgTraceInspectorArguments {
  command: 'enable' | 'disable' | 'logs'
}

export interface RdbgTraceInspectorEnableArguments extends RdbgTraceInspectorArguments {
  command: 'enable'
  arguments: {
    type: ('line' | 'call' | 'return')[];
  }
}

export interface RdbgTraceInspectorDisableArguments extends RdbgTraceInspectorArguments {
  command: 'disable'
}

export interface RdbgTraceInspectorLogsArguments extends RdbgTraceInspectorArguments {
  command: 'logs'
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
