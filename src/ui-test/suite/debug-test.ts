import * as assert from "assert";

import { ActivityBar, DebugToolbar, DebugView, DefaultTreeSection, EditorView, TextEditor, TitleBar, VSBrowser, Workbench, BottomBarPanel, DebugConsoleView, SideBarView } from "vscode-extension-tester";

import * as path from "path";

const timeoutSec = 60000;
const projectRoot = path.join(__dirname, "..", "..", "..");
const simpleProgramPath = path.join(projectRoot, "src", "ui-test", "testdata", "simpleProgram");
const importAnotherFilePath = path.join(projectRoot, "src", "ui-test", "testdata", "importAnotherFile");
const bindingBreakPath = path.join(projectRoot, "src", "ui-test", "testdata", "bindingBreak");

describe("breakpoint", () => {
	describe("simpleProgram", () => {
		beforeEach(async function () {
			this.timeout(timeoutSec);

			await openSampleProgram(simpleProgramPath, "simpleProgram", "test.rb");
		});

		afterEach(async () => {
			await cleanup();
		});

		describe("set breakpoint", () => {
			it("editor", async () => {
				const editor = (await new EditorView().openEditor("test.rb")) as TextEditor;
				const expected = 2;
				const result = await editor.toggleBreakpoint(expected);
				assert.ok(result);
				const view = await getDebugView();
				await view.start();
				const bar = await DebugToolbar.create(timeoutSec);
				await bar.waitForBreakPoint();
				await assertLocation(expected, view);
				await bar.stop();
				return new Promise((resolve, _reject) => resolve());
			});

			it("debug console", async () => {
				const editor = (await new EditorView().openEditor("test.rb")) as TextEditor;
				const result = await editor.toggleBreakpoint(2);
				assert.ok(result);
				const view = await getDebugView();
				await view.start();
				const bar = await DebugToolbar.create(timeoutSec);
				await bar.waitForBreakPoint();
				await assertLocation(2, view);
				const debugView = await new BottomBarPanel().openDebugConsoleView();
				await assertEvaluate("(rdbg:command) b 3", ",b 3", debugView);
				await assertEvaluate("(rdbg:command) c", ",c", debugView);
				await bar.waitForBreakPoint();
				await assertLocation(3, view);
				await bar.stop();
				return new Promise((resolve, _reject) => resolve());
			});
		});

		describe("remove breakpoint", () => {
			it("debug console", async () => {
				const editor = (await new EditorView().openEditor("test.rb")) as TextEditor;
				const expected = 2;
				const result = await editor.toggleBreakpoint(expected);
				assert.ok(result);
				const view = await getDebugView();
				await view.start();
				const bar = await DebugToolbar.create(timeoutSec);
				await bar.waitForBreakPoint();
				await assertLocation(expected, view);
				const debugView = await new BottomBarPanel().openDebugConsoleView();
				await assertEvaluate("(rdbg:command) b 3", ",b 3", debugView);
				await assertEvaluate("(rdbg:command) b 4", ",b 4", debugView);
				await assertEvaluate("deleted: #1", ",del 1", debugView);
				await assertEvaluate("(rdbg:command) c", ",c", debugView);
				await bar.waitForBreakPoint();
				await assertLocation(4, view);
				await bar.stop();
				return new Promise((resolve, _reject) => resolve());
			});
		});
	});

	describe("importAnotherFile", () => {
		beforeEach(async function () {
			this.timeout(timeoutSec);

			await openSampleProgram(importAnotherFilePath, "importAnotherFile", "bar.rb");
		});

		afterEach(async () => {
			await cleanup();
		});

		it("debug tool bar", async () => {
			const barFileTab = (await new EditorView().openEditor("bar.rb")) as TextEditor;
			const result = await barFileTab.toggleBreakpoint(2);
			assert.ok(result);
			const view = await getDebugView();
			await view.start();
			const bar = await DebugToolbar.create(timeoutSec);
			await bar.waitForBreakPoint();
			await assertLocation(2, view);
			await openFile("importAnotherFile", "foo.rb");
			// Since the following error ocuurs when using openEditor('foo.rb'), getTabByTitle is used here:
			// ```
			// 	ElementClickInterceptedError: element click intercepted: Element <div draggable="true"...
			// ```
			const fooFileTab = new TextEditor();
			const result2 = await fooFileTab.toggleBreakpoint(8);
			assert.ok(result2);
			await bar.continue();
			await bar.waitForBreakPoint();
			await assertLocation(8, view);
			await bar.stop();
			return new Promise((resolve, _reject) => resolve());
		});

		it("debug console", async () => {
			const barFileTab = (await new EditorView().openEditor("bar.rb")) as TextEditor;
			const result = await barFileTab.toggleBreakpoint(2);
			assert.ok(result);
			const view = await getDebugView();
			await view.start();
			const bar = await DebugToolbar.create(timeoutSec);
			await bar.waitForBreakPoint();
			await assertLocation(2, view);
			const debugView = await new BottomBarPanel().openDebugConsoleView();
			await assertEvaluate("BP - Line", ",b foo.rb:8", debugView);
			await assertEvaluate("(rdbg:command) c", ",c", debugView);
			await bar.waitForBreakPoint();
			await assertLocation(8, view);
			await bar.stop();
			return new Promise((resolve, _reject) => resolve());
		});
	});
});

describe("step", () => {
	describe("simpleProgram", () => {
		beforeEach(async function () {
			this.timeout(timeoutSec);

			await openSampleProgram(simpleProgramPath, "simpleProgram", "test.rb");
		});

		afterEach(async () => {
			await cleanup();
		});

		it("debug tool bar", async () => {
			const editor = (await new EditorView().openEditor("test.rb")) as TextEditor;
			const result = await editor.toggleBreakpoint(2);
			assert.ok(result);
			const view = await getDebugView();
			await view.start();
			const bar = await DebugToolbar.create(timeoutSec);
			await bar.waitForBreakPoint();
			await assertLocation(2, view);
			await bar.stepInto();
			await assertLocation(3, view);
			await bar.stepInto();
			await assertLocation(4, view);
			await bar.stop();
			return new Promise((resolve, _reject) => resolve());
		});

		it("debug console", async () => {
			const editor = (await new EditorView().openEditor("test.rb")) as TextEditor;
			const result = await editor.toggleBreakpoint(2);
			assert.ok(result);
			const view = await getDebugView();
			await view.start();
			const bar = await DebugToolbar.create(timeoutSec);
			await bar.waitForBreakPoint();
			await assertLocation(2, view);
			const debugView = await new BottomBarPanel().openDebugConsoleView();
			await assertEvaluate("(rdbg:command) s", ",s", debugView);
			await assertLocation(3, view);
			await bar.stop();
			return new Promise((resolve, _reject) => resolve());
		});
	});
});

describe("next", () => {
	describe("simpleProgram", () => {
		beforeEach(async function () {
			this.timeout(timeoutSec);

			await openSampleProgram(simpleProgramPath, "simpleProgram", "test.rb");
		});

		afterEach(async () => {
			await cleanup();
		});

		it("debug tool bar", async () => {
			const editor = (await new EditorView().openEditor("test.rb")) as TextEditor;
			const view = await getDebugView();
			const result = await editor.toggleBreakpoint(2);
			assert.ok(result);
			await view.start();
			const bar = await DebugToolbar.create(timeoutSec);
			await bar.waitForBreakPoint();
			await assertLocation(2, view);
			await bar.stepOver();
			await assertLocation(3, view);
			await bar.stepOver();
			await assertLocation(4, view);
			await bar.stop();
			return new Promise((resolve, _reject) => resolve());
		});

		it("debug console", async () => {
			const editor = (await new EditorView().openEditor("test.rb")) as TextEditor;
			const result = await editor.toggleBreakpoint(2);
			assert.ok(result);
			const view = await getDebugView();
			await view.start();
			const bar = await DebugToolbar.create(timeoutSec);
			await bar.waitForBreakPoint();
			await assertLocation(2, view);
			const debugView = await new BottomBarPanel().openDebugConsoleView();
			await assertEvaluate("(rdbg:command) n", ",n", debugView);
			await view.click();
			await assertLocation(3, view);
			await bar.stop();
			return new Promise((resolve, _reject) => resolve());
		});
	});
});

describe("eval", () => {
	describe("simpleProgram", () => {
		beforeEach(async function () {
			this.timeout(timeoutSec);

			await openSampleProgram(simpleProgramPath, "simpleProgram", "test.rb");
		});

		afterEach(async () => {
			await cleanup();
		});

		it("debug console", async () => {
			const editor = (await new EditorView().openEditor("test.rb")) as TextEditor;
			const result = await editor.toggleBreakpoint(2);
			assert.ok(result);
			const view = await getDebugView();
			await view.start();
			const bar = await DebugToolbar.create(timeoutSec);
			await bar.waitForBreakPoint();
			await assertLocation(2, view);
			const debugView = await new BottomBarPanel().openDebugConsoleView();
			await assertEvaluate("1", "a", debugView);
			await assertEvaluate("nil", "b", debugView);
			await bar.stepOver();
			await assertLocation(3, view);
			await assertEvaluate("2", "b", debugView);
			await bar.stop();
			return new Promise((resolve, _reject) => resolve());
		});
	});
});

describe("binding.break", () => {
	beforeEach(async function () {
		this.timeout(timeoutSec);

		await openSampleProgram(bindingBreakPath, "bindingBreak", "test.rb");
	});

	afterEach(async () => {
		await cleanup();
	});

	it("debug tool bar", async () => {
		const view = await getDebugView();
		await view.start();
		const bar = await DebugToolbar.create(timeoutSec);
		await bar.waitForBreakPoint();
		await assertLocation(5, view);
		await bar.continue();
		await assertLocation(8, view);
		await bar.stop();
		return new Promise((resolve, _reject) => resolve());
	});
});

async function assertLocation(expected: number, view: DebugView) {
	const tree = await view.getContent().getSection("Call Stack") as DefaultTreeSection;
	const items = await tree.getVisibleItems();
	if (items.length === 0) {
		assert.fail("Call Stack Section is not visible");
	}
	const text = await items[0].getText();
	const location = text.match(/(\d+):(\d+)$/);
	if (location === null || location.length !== 3) {
		assert.fail("Can't get location from Call Stack Section");
	}
	const lineNumber = parseInt(location[1]);
	assert.strictEqual(lineNumber, expected);
}

async function getDebugView(): Promise<DebugView> {
	const control = await new ActivityBar().getViewControl("Run");
	if (control === undefined) {
		assert.fail("Can't find a View for debug");
	}
	return await control.openView() as DebugView;
}

async function openSampleProgram(path: string, sectionTitle: string, targetFileName: string) {
	await VSBrowser.instance.openResources(path);

	await openFile(sectionTitle, targetFileName);
}

async function openFile(sectionTitle: string, targetFileName: string) {
	(await new ActivityBar().getViewControl("Explorer"))?.openView();

	const view = new SideBarView();
	const tree = (await view.getContent().getSection(sectionTitle)) as DefaultTreeSection;
	const item = await tree.findItem(targetFileName);
	if (item === undefined) {
		assert.fail(`Can't find item: ${item}`);
	}
	await item.select();
}

async function assertEvaluate(expected: string, expression: string, view: DebugConsoleView) {
	await view.evaluateExpression(expression);
	await new Promise(res => setTimeout(res, 1000));
	const text = await view.getText();
	assert.ok(text.includes(expected), `Expected to include ${expected} in ${text}, but not.`);
	await view.clearText();
	await view.wait(timeoutSec);
}

async function cleanup() {
	await VSBrowser.instance.waitForWorkbench();
	await new Workbench().executeCommand("Remove All Breakpoints");
	await new Promise(res => setTimeout(res, 2000));
	await (await new ActivityBar().getViewControl("Run"))?.closeView();
	await (await new ActivityBar().getViewControl("Explorer"))?.closeView();
	await new TitleBar().select("File", "Close Folder");
	await new EditorView().closeAllEditors();
}
