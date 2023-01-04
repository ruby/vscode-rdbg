import * as vscode from "vscode";

export async function customRequest(session: vscode.DebugSession, command: string, args?: any) {
	try {
		return await session.customRequest(command, args);
	} catch (error) {
		console.error(error);
		return undefined;
	}
};
