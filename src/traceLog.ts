export interface Location {
	path: string;
	line: number;
}

export interface TraceLogsArguments {
	type: 'line' | 'call' | 'exception' | 'dap';
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
