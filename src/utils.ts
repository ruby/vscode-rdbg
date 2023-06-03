import * as vscode from "vscode";
import { LaunchConfiguration } from "./config";
import * as path from "path";
import * as fs from "fs";

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

export function fullPath(p: string, session: vscode.DebugSession | undefined) {
    if (path.isAbsolute(p)) {
        return p;
    }
    const workspace = session?.workspaceFolder;
    if (workspace === undefined) {
        return p;
    }
    const fullPath = path.join(workspace.uri.fsPath, p);
    if (fs.existsSync(fullPath)) {
        return fullPath;
    }
    return p;
}
