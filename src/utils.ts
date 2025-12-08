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

/**
 * Parse a .env file and return environment variables as key-value pairs
 * Supports:
 * - KEY=VALUE format
 * - Comments (lines starting with #)
 * - Quoted values (single and double quotes)
 * - Empty lines
 * @param envFilePath Path to the .env file
 * @returns Object containing environment variables, or undefined if file doesn't exist
 */
export function parseEnvFile(envFilePath: string): { [key: string]: string } | undefined {
    if (!fs.existsSync(envFilePath)) {
        return undefined;
    }

    try {
        const content = fs.readFileSync(envFilePath, "utf8");
        const env: { [key: string]: string } = {};
        const lines = content.split(/\r?\n/);

        for (let line of lines) {
            line = line.trim();

            if (line === "" || line.startsWith("#")) {
                continue;
            }

            const equalIndex = line.indexOf("=");
            if (equalIndex === -1) {
                continue;
            }

            const key = line.substring(0, equalIndex).trim();
            let value = line.substring(equalIndex + 1).trim();

            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length - 1);
            }

            if (key) {
                env[key] = value;
            }
        }

        return env;
    } catch (error) {
        return undefined;
    }
}
