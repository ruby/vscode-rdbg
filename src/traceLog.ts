import * as vscode from 'vscode';

export interface Location {
	name: string;
	path: string;
	line: number;
}

export interface TraceLogsEvent extends vscode.DebugSessionCustomEvent {
	body: {
		call?: {
			size: number;
		};
		line?: {
			size: number;
		};
		exception?: {
			size: number;
		};
	}
}

export interface TraceLogRootResponse {
	logs: TraceLog[];
}

export interface TraceLogRootArguments {
	type: 'line' | 'call' | 'exception';
	offset: number;
	pageSize: number;
}

export interface TraceLogChildrenResponse {
	logs: TraceLog[];
}

export interface TraceLogChildrenArguments {
	index: number;
	type: 'line' | 'call' | 'exception';
	offset: number;
	pageSize: number;
}

export interface TraceLogParentResponse {
	log: TraceLog | null;
}

export interface TraceLogParentArguments {
	index: number;
	type: 'line' | 'call' | 'exception';
	offset: number;
	pageSize: number;
}

export interface TraceLogsArguments {
	type: 'line' | 'call' | 'exception';
}

export interface TraceLogsResponse {
	logs: TraceLog2[];
}

export interface TraceLog {
	hasChild?: boolean;
	location: Location;
	name: string | null;
	index: number;
}

export interface TraceLog2 {
	hasChild?: boolean;
	location: Location;
	name: string | null;
	depth: number;
	index: number;
}
