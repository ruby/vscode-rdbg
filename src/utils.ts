import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import { PagenationItem, RdbgTreeItem } from './rdbgTreeItem';

export function getPageNationItems(pageSize: number, selectedIdx: number) {
	const pages = [];
	let i = 1;
	while (true) {
		const offset = (i - 1) * pageSize;
		const page = new PagenationItem(
			`Page ${i}`,
			offset,
			{ collapsibleState: vscode.TreeItemCollapsibleState.Collapsed }
		);
		pages.push(page);
		if (i * pageSize > selectedIdx) {
			break;
		}
		page.id = `Page ${i}`;
		i++;
	}
	pages[pages.length - 1].isLastPage = true;
	pages[pages.length - 1].collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
	return pages;
}

export async function sendDebugCommand(session: vscode.DebugSession, cmd: string) {
	const args: DebugProtocol.EvaluateArguments = {
		expression: `,${cmd}`,
		context: 'repl'
	};
	try {
		await session.customRequest('evaluate', args);
	} catch (err) { }
	try {
		await session.customRequest('completions');
	} catch (err) { }
};
