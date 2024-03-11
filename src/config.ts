import { DebugConfiguration } from "vscode";

export interface AttachConfiguration extends DebugConfiguration {
    type: "rdbg";
    request: "attach";
    rdbgPath?: string;
    env?: { [key: string]: string };
    debugPort?: string;
    cwd?: string;
    showProtocolLog?: boolean;

    autoAttach?: string;
}

export interface LaunchConfiguration extends DebugConfiguration {
    type: "rdbg";
    request: "launch";

    script: string;

    command?: string; // ruby
    cwd?: string;
    args?: string[];
    env?: { [key: string]: string };

    debugPort?: string;
    waitLaunchTime?: number;

    useBundler?: boolean;
    askParameters?: boolean;

    rdbgPath?: string;
    showProtocolLog?: boolean;

    useTerminal?: boolean;
}
