import * as vscode from "vscode";
import { LaunchConfiguration } from "./config";

export async function customRequest(session: vscode.DebugSession, command: string, args?: any) {
	try {
		return await session.customRequest(command, args);
	} catch (error) {
		console.error(error);
		return undefined;
	}
};

export interface VersionChecker {
    getVersion(config: LaunchConfiguration): Promise<string | null>;
    vernum(version: string): number;
}
