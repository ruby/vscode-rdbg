export interface Location {
	path: string;
	line: number;
}

export interface TraceLogRootResponse {
	logs: TraceLog[];
}

export interface TraceLogRootArguments {
	type: 'line' | 'call' | 'exception' | 'dap';
	offset: number;
	pageSize: number;
}

export interface TraceLogChildrenResponse {
	logs: TraceLog[];
}

export interface TraceLogChildrenArguments {
	index: number;
	type: 'line' | 'call' | 'exception' | 'dap';
	offset: number;
	pageSize: number;
}

export interface TraceLogParentResponse {
	log: TraceLog | null;
}

export interface TraceLogParentArguments {
	index: number;
	type: 'line' | 'call' | 'exception' | 'dap';
	offset: number;
	pageSize: number;
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
