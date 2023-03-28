import * as vscode from "vscode";

export async function customRequest(session: vscode.DebugSession, command: string, args?: any) {
	try {
		return await session.customRequest(command, args);
	} catch (error) {
		console.error(error);
		return undefined;
	}
};

export class RdbgDecorationProvider implements vscode.FileDecorationProvider {
	private static provider: RdbgDecorationProvider | undefined;
	static create(): vscode.Disposable | undefined {
		if (RdbgDecorationProvider.provider) {
			return undefined;
		}
		RdbgDecorationProvider.provider = new RdbgDecorationProvider();
		return RdbgDecorationProvider.provider;
	}

	private readonly disposables: vscode.Disposable[];
	private constructor() {
		this.disposables = [
			vscode.window.registerFileDecorationProvider(this),
		];
	}

	dispose() {
		while(this.disposables.length > 0) {
			const disp = this.disposables.pop();
			disp?.dispose();
		}
		RdbgDecorationProvider.provider = undefined;
	}

	provideFileDecoration(uri: vscode.Uri, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
		if (uri.toString() !== vscode.Uri.parse("http://example.com").toString()) {
			return void 0;
		}
		return {
			color: new vscode.ThemeColor("textLink.foreground")
		};
	}
}
