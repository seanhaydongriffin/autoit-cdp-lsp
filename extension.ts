import * as path from 'path';
import {
    workspace, ExtensionContext, window, commands, StatusBarAlignment, env, Uri,
    tests, TestRunProfileKind, Range, TestMessage,
    TestController, TestItem, TestRunRequest, CancellationToken
} from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import { findTests, buildSingleTestScript } from './testScanner';

let client: LanguageClient;
let runningProcesses: any[] = [];
// True from the moment F5 is accepted until the whole check+run chain has finished,
// so a second F5 can't slip in (e.g. during the async document save before spawn)
let runInProgress = false;
const isWindows = process.platform === 'win32';

export function activate(context: ExtensionContext) {
    const serverModule = context.asAbsolutePath(
        path.join('out', 'server', 'server.js')
    );

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'autoit' }],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
        }
    };

    client = new LanguageClient(
        'autoitLanguageServer',
        'AutoIt Language Server',
        serverOptions,
        clientOptions
    );

    client.start();

    // Output channel for run/check
    const out = window.createOutputChannel('AutoIt');
    context.subscriptions.push(out);

    // Status bar Run/Stop buttons, shown while an AutoIt editor is active or a script is running
    const runButton = window.createStatusBarItem(StatusBarAlignment.Left, 100);
    runButton.text = '$(play) Run AutoIt';
    runButton.tooltip = 'Run the current AutoIt script (F5)';
    runButton.command = 'autoit-lsp.runScript';

    const stopButton = window.createStatusBarItem(StatusBarAlignment.Left, 99);
    stopButton.text = '$(debug-stop) Stop';
    stopButton.tooltip = 'Stop running AutoIt scripts (Ctrl+Break)';
    stopButton.command = 'autoit-lsp.stopScript';

    context.subscriptions.push(runButton, stopButton);

    function updateStatusBarButtons() {
        const isAutoItEditor = window.activeTextEditor?.document.languageId === 'autoit';
        if (isAutoItEditor || runningProcesses.length > 0) {
            runButton.show();
            stopButton.show();
        } else {
            runButton.hide();
            stopButton.hide();
        }
    }
    updateStatusBarButtons();
    context.subscriptions.push(window.onDidChangeActiveTextEditor(updateStatusBarButtons));

    function killRunningProcesses() {
        if (runningProcesses.length === 0) {
            //out.appendLine('No AutoIt processes are currently running.');
            return;
        }

        //out.appendLine('Stopping AutoIt processes...');
        out.appendLine('>Forcing abrupt termination...');
        runningProcesses.forEach((proc) => {
            try {
                if (isWindows) {
                    const kill = require('child_process').spawn('taskkill', ['/PID', proc.pid.toString(), '/T', '/F']);
                    kill.on('close', (code: number | null) => {
                        //out.appendLine(`taskkill exited with code ${code}`);
                    });
                } else {
                    proc.kill('SIGTERM');
                }
            } catch (err: any) {
                out.appendLine(`Failed to stop process ${proc.pid}: ${err.message}`);
            }
        });
        runningProcesses = [];
        runInProgress = false;
        updateStatusBarButtons();
    }

    // Register run command (F5)
    const runCmd = commands.registerCommand('autoit-lsp.runScript', async () => {
        // Only one script at a time, matching SciTe behavior
        if (runInProgress || runningProcesses.length > 0) {
            window.showInformationMessage('An AutoIt script is already running. Stop it (Ctrl+Break) or wait for it to finish.');
            return;
        }
        runInProgress = true;

        const editor = window.activeTextEditor;
        if (!editor) {
            runInProgress = false;
            window.showErrorMessage('No active editor to run');
            return;
        }

        const doc = editor.document;
        if (doc.isUntitled) {
            runInProgress = false;
            window.showErrorMessage('Please save the script before running.');
            return;
        }

        // Save the document first
        await doc.save();

        const filePath = doc.fileName;

        const cfg = workspace.getConfiguration('autoit');
        const checkPath = cfg.get<string>('checkPath') || 'C:\\Program Files (x86)\\AutoIt3\\Au3Check.exe';

        // Prefer the 32-bit AutoIt runtime (AutoIt3.exe) if present — SciTe uses it by default.
        const configuredRunner = cfg.get<string>('runnerPath');
        const default32 = 'C:\\Program Files (x86)\\AutoIt3\\AutoIt3.exe';
        const default64 = 'C:\\Program Files (x86)\\AutoIt3\\autoit3_x64.exe';
        const fs = require('fs');
        let runnerPath = configuredRunner || '';
        if (!runnerPath) {
            if (fs.existsSync(default32)) runnerPath = default32;
            else runnerPath = default64;
        }

        out.clear();
        out.show(true);
        //out.appendLine(`Running Au3Check: ${checkPath} ${filePath}`);

        const { spawn } = require('child_process');

        const childOptions = { cwd: path.dirname(filePath), env: process.env } as any;

        function streamProcess(cmd: string, args: string[], onClose?: (code: number | null) => void) {
            try {
                const p = spawn(cmd, args, childOptions);
                runningProcesses.push(p);
                updateStatusBarButtons();
                p.stdout.on('data', (chunk: Buffer) => out.append(chunk.toString()));
                p.stderr.on('data', (chunk: Buffer) => out.append(chunk.toString()));
                p.on('error', (err: any) => out.appendLine(`Failed to start ${cmd}: ${err.message}`));
                p.on('close', (code: number | null) => {
                    //out.appendLine(`${path.basename(cmd)} exited with code ${code}`);
                    //if (path.basename(cmd) == "autoit3_x64.exe") out.appendLine(`>Exit code: ${code}`);
                    out.appendLine(`>Exit code: ${code}`);
                    runningProcesses = runningProcesses.filter((proc) => proc !== p);
                    updateStatusBarButtons();
                    if (onClose) onClose(code);
                    // onClose may have spawned a follow-up process (check -> run);
                    // only release the run lock once the chain has fully drained
                    if (runningProcesses.length === 0) {
                        runInProgress = false;
                    }
                });
                return p;
            } catch (e: any) {
                out.appendLine(`Error spawning ${cmd}: ${e.message}`);
                if (onClose) onClose?.(1);
                if (runningProcesses.length === 0) {
                    runInProgress = false;
                }
                return null;
            }
        }

        //out.appendLine(`Spawning Au3Check: ${checkPath} ${filePath}`);
        if (fs.existsSync(checkPath)) {
            streamProcess(checkPath, ["-q", filePath], (code) => {
                // Only run the script if Au3Check passed, matching SciTe behavior
                if (code === 2) {
                    out.appendLine(`!>Au3Check ended with errors. Script not run.`);
                    return;
                }
                out.appendLine(`Spawning AutoIt: ${runnerPath} "${filePath}" (cwd: ${childOptions.cwd})`);
                streamProcess(runnerPath, [filePath]);
            });
        } else {
            out.appendLine(`Au3Check not found at ${checkPath}, skipping check.`);
            out.appendLine(`Spawning AutoIt: ${runnerPath} "${filePath}" (cwd: ${childOptions.cwd})`);
            streamProcess(runnerPath, [filePath]);
        }
    });

    context.subscriptions.push(runCmd);

    // Register 'Go' command that delegates to the same runner (used from menu)
    const goCmd = commands.registerCommand('autoit-lsp.go', async () => {
        await commands.executeCommand('autoit-lsp.runScript');
    });
    context.subscriptions.push(goCmd);

    // Register 'Start Debugging' command for Run menu to mimic SciTe's Start Debugging
    const startDebugCmd = commands.registerCommand('autoit-lsp.startDebug', async () => {
        await commands.executeCommand('autoit-lsp.runScript');
    });
    context.subscriptions.push(startDebugCmd);

    // Register 'Start AutoIt' command (explicit non-debug run from Run menu)
    const startAutoItCmd = commands.registerCommand('autoit-lsp.startAutoIt', async () => {
        await commands.executeCommand('autoit-lsp.runScript');
    });
    context.subscriptions.push(startAutoItCmd);

    const stopCmd = commands.registerCommand('autoit-lsp.stopScript', async () => {
        killRunningProcesses();
    });
    context.subscriptions.push(stopCmd);

    // Register 'Debug to Console' command (Alt+D): inserts a ConsoleWrite debug line
    // below the selection, mimicking SciTe's debug-to-console helper
    const debugConsoleCmd = commands.registerCommand('autoit-lsp.debugToConsole', async () => {
        const editor = window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'autoit') {
            return;
        }
        const text = editor.document.getText(editor.selection).trim();
        if (!text) {
            window.showInformationMessage('Highlight an expression to debug first.');
            return;
        }
        const line = editor.document.lineAt(editor.selection.end.line);
        const indent = line.text.match(/^\s*/)?.[0] ?? '';
        const debugLine = `${indent}ConsoleWrite('@@ Debug(' & @ScriptLineNumber & ') : ${text} = ' & ${text} & @CRLF & '>Error code: ' & @error & @CRLF)`;
        await editor.edit((editBuilder) => {
            editBuilder.insert(line.range.end, '\n' + debugLine);
        });
    });
    context.subscriptions.push(debugConsoleCmd);

    // Register 'Context Help' command (Ctrl+F1): opens the AutoIt help file at the
    // topic for the word under the cursor, mimicking SciTe's F1 context help.
    // AutoIt3Help.exe resolves the keyword to the right CHM topic itself.
    const contextHelpCmd = commands.registerCommand('autoit-lsp.contextHelp', async () => {
        const editor = window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'autoit') {
            return;
        }
        // Use the selection if there is one, otherwise the word under the cursor
        // (including a leading @ or # for macros and directives)
        let word = editor.document.getText(editor.selection).trim();
        if (!word) {
            const range = editor.document.getWordRangeAtPosition(editor.selection.active, /[#@]?[A-Za-z0-9_-]+/);
            if (range) {
                word = editor.document.getText(range);
            }
        }
        if (!word) {
            window.showInformationMessage('Place the cursor on an AutoIt keyword to look up help.');
            return;
        }

        const cfg = workspace.getConfiguration('autoit');
        const helpPath = cfg.get<string>('helpPath') || 'C:\\Program Files (x86)\\AutoIt3\\AutoIt3Help.exe';
        const fs = require('fs');
        if (fs.existsSync(helpPath)) {
            const help = require('child_process').spawn(helpPath, [word], { detached: true, stdio: 'ignore' });
            help.unref();
        } else {
            // Fall back to the online documentation
            const url = word.startsWith('@')
                ? 'https://www.autoitscript.com/autoit3/docs/macros.htm'
                : word.startsWith('#')
                    ? 'https://www.autoitscript.com/autoit3/docs/keywords.htm'
                    : `https://www.autoitscript.com/autoit3/docs/functions/${word}.htm`;
            env.openExternal(Uri.parse(url));
        }
    });
    context.subscriptions.push(contextHelpCmd);

    // ---------------------------------------------------------------------------
    // Test Explorer integration.
    // Discovers top-level `With test("...")` blocks and runs a selected test by
    // generating a temp script (shared setup + only that one block) in the script's
    // own folder — so @ScriptDir and all relative dependencies resolve — then runs
    // it as an ordinary script. Each test = its own process = its own exit code.
    // ---------------------------------------------------------------------------
    const testController = tests.createTestController('autoitCdpTests', 'AutoIt CDP Tests');
    context.subscriptions.push(testController);

    function fileItemFor(uri: Uri): TestItem {
        const id = uri.toString();
        let item = testController.items.get(id);
        if (!item) {
            item = testController.createTestItem(id, path.basename(uri.fsPath), uri);
            testController.items.add(item);
        }
        return item;
    }

    function parseTextIntoItems(uri: Uri, text: string) {
        const blocks = findTests(text);
        if (blocks.length === 0) {
            testController.items.delete(uri.toString());
            return;
        }
        const fileItem = fileItemFor(uri);
        const seen = new Set<string>();
        for (const b of blocks) {
            const childId = uri.toString() + '::' + b.name;
            let child = fileItem.children.get(childId);
            if (!child) {
                child = testController.createTestItem(childId, b.name, uri);
                fileItem.children.add(child);
            }
            child.range = new Range(b.startLine, 0, b.endLine, 0);
            seen.add(childId);
        }
        const stale: string[] = [];
        fileItem.children.forEach((c) => { if (!seen.has(c.id)) { stale.push(c.id); } });
        stale.forEach((id) => fileItem.children.delete(id));
    }

    async function parseUriIntoItems(uri: Uri) {
        try {
            const bytes = await workspace.fs.readFile(uri);
            parseTextIntoItems(uri, Buffer.from(bytes).toString('utf8'));
        } catch { /* unreadable - ignore */ }
    }

    // Initial discovery across the workspace
    (async () => {
        const files = await workspace.findFiles('**/*.au3', '**/node_modules/**');
        for (const f of files) { await parseUriIntoItems(f); }
    })();

    // Keep the tree in sync with edits/creates/deletes
    const au3Watcher = workspace.createFileSystemWatcher('**/*.au3');
    au3Watcher.onDidCreate((uri) => parseUriIntoItems(uri));
    au3Watcher.onDidChange((uri) => parseUriIntoItems(uri));
    au3Watcher.onDidDelete((uri) => testController.items.delete(uri.toString()));
    context.subscriptions.push(au3Watcher);
    context.subscriptions.push(workspace.onDidSaveTextDocument((doc) => {
        if (doc.languageId === 'autoit') { parseTextIntoItems(doc.uri, doc.getText()); }
    }));

    function resolveRunnerPath(): string {
        const cfg = workspace.getConfiguration('autoit');
        const configured = cfg.get<string>('runnerPath');
        if (configured) { return configured; }
        const fs = require('fs');
        const default32 = 'C:\\Program Files (x86)\\AutoIt3\\AutoIt3.exe';
        const default64 = 'C:\\Program Files (x86)\\AutoIt3\\autoit3_x64.exe';
        return fs.existsSync(default32) ? default32 : default64;
    }

    // Find the test's HTML report inside its test-results\<name> folder. The UDF's filename has
    // changed over time (report.html -> "<name> test run.html"), so match any .html and take the
    // newest rather than hard-coding a name.
    function findReportHtml(folder: string): string | null {
        const fs = require('fs');
        let entries: string[];
        try { entries = fs.readdirSync(folder); } catch { return null; }
        const htmls = entries
            .filter((f: string) => f.toLowerCase().endsWith('.html'))
            .map((f: string) => path.join(folder, f));
        if (htmls.length === 0) { return null; }
        htmls.sort((a: string, b: string) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        return htmls[0];
    }

    // Flatten a requested item to the concrete tests underneath it (file item -> its tests).
    function collectRunnable(item: TestItem, acc: TestItem[]) {
        if (item.children.size > 0) {
            item.children.forEach((c) => collectRunnable(c, acc));
        } else {
            acc.push(item);
        }
    }

    function runOneTest(test: TestItem, run: any): Promise<void> {
        return new Promise<void>((resolve) => {
            const fs = require('fs');
            const { spawn } = require('child_process');
            const uri = test.uri;
            if (!uri) { run.skipped(test); return resolve(); }

            let fileText: string;
            try { fileText = fs.readFileSync(uri.fsPath, 'utf8'); }
            catch (e: any) { run.failed(test, new TestMessage('Cannot read file: ' + e.message)); return resolve(); }

            const single = buildSingleTestScript(fileText, test.label);
            if (single === null) {
                run.failed(test, new TestMessage('Could not locate test block "' + test.label + '"'));
                return resolve();
            }

            // Temp runner lives in the SAME folder as the source so @ScriptDir resolves.
            const dir = path.dirname(uri.fsPath);
            const tempPath = path.join(dir, '__attest_' + process.pid + '_' + Date.now() + '.au3');
            try { fs.writeFileSync(tempPath, single, 'utf8'); }
            catch (e: any) { run.failed(test, new TestMessage('Cannot write temp runner: ' + e.message)); return resolve(); }

            const cleanup = () => { try { fs.unlinkSync(tempPath); } catch { /* ignore */ } };
            const started = Date.now();
            out.appendLine('=== Running test: ' + test.label + ' ===');

            let p: any;
            try {
                p = spawn(resolveRunnerPath(), [tempPath], { cwd: dir, env: process.env });
            } catch (e: any) {
                run.failed(test, new TestMessage('Failed to launch runner: ' + e.message));
                cleanup();
                return resolve();
            }
            runningProcesses.push(p);
            updateStatusBarButtons();

            let output = '';
            const onData = (chunk: Buffer) => {
                const s = chunk.toString();
                output += s;
                out.append(s);
                run.appendOutput(s.replace(/\r?\n/g, '\r\n'));
            };
            p.stdout.on('data', onData);
            p.stderr.on('data', onData);
            p.on('error', (err: any) => {
                run.failed(test, new TestMessage('Process error: ' + err.message));
                runningProcesses = runningProcesses.filter((x) => x !== p);
                updateStatusBarButtons();
                cleanup();
                resolve();
            });
            p.on('close', (code: number | null) => {
                const dur = Date.now() - started;
                // Result contract (interim): exit 0 = pass, anything else = fail.
                // Refine once the UDF emits richer status/soft-fail codes.
                if (code === 0) {
                    run.passed(test, dur);
                } else {
                    run.failed(test, new TestMessage('Test exited with code ' + code + '\n\n' + output.slice(-4000)), dur);
                }
                // Surface the test's HTML report as a clickable path in the run output.
                const reportPath = findReportHtml(path.join(dir, 'test-results', test.label));
                if (reportPath) {
                    run.appendOutput('Report: ' + reportPath + '\r\n');
                }
                out.appendLine('>Exit code: ' + code);
                runningProcesses = runningProcesses.filter((x) => x !== p);
                updateStatusBarButtons();
                cleanup();
                resolve();
            });
        });
    }

    async function testRunHandler(request: TestRunRequest, token: CancellationToken) {
        if (runInProgress || runningProcesses.length > 0) {
            window.showInformationMessage('An AutoIt script is already running. Stop it (Ctrl+Break) or wait for it to finish.');
            return;
        }

        const queue: TestItem[] = [];
        if (request.include) {
            request.include.forEach((t) => collectRunnable(t, queue));
        } else {
            testController.items.forEach((t) => collectRunnable(t, queue));
        }
        if (queue.length === 0) { return; }

        const run = testController.createTestRun(request);
        // Cancelling the run kills the in-flight test process (reuses the Stop machinery).
        const cancelSub = token.onCancellationRequested(() => killRunningProcesses());
        runInProgress = true;
        updateStatusBarButtons();
        out.clear();
        out.show(true);

        // Sequential — the tests share the same real ADS backend/session.
        for (const test of queue) {
            if (token.isCancellationRequested) { run.skipped(test); continue; }
            run.started(test);
            await runOneTest(test, run);
        }

        runInProgress = false;
        updateStatusBarButtons();
        cancelSub.dispose();
        run.end();
    }

    testController.createRunProfile('Run', TestRunProfileKind.Run, testRunHandler, true);

    // Right-click a test in the Explorer -> open its HTML report in the default browser.
    const openReportCmd = commands.registerCommand('autoit-lsp.openTestReport', async (item?: TestItem) => {
        if (!item || !item.uri || item.children.size > 0) {
            window.showInformationMessage('Right-click a single test to open its report.');
            return;
        }
        const reportPath = findReportHtml(path.join(path.dirname(item.uri.fsPath), 'test-results', item.label));
        if (!reportPath) {
            window.showInformationMessage('No report yet for "' + item.label + '". Run the test first.');
            return;
        }
        await env.openExternal(Uri.file(reportPath));
    });
    context.subscriptions.push(openReportCmd);

    // Right-click test(s) in the Explorer -> copy their HTML reports into a folder you choose
    // (handy for consolidating reports from many tests into one place). Supports multi-select:
    // VS Code passes the focused item first and the full selection as the 2nd argument.
    const copyReportCmd = commands.registerCommand('autoit-lsp.copyTestReport', async (...args: any[]) => {
        // The Testing view passes each selected test as its own positional argument
        // (not the (item, array) shape custom TreeViews use). Also tolerate an array arg
        // and a lone item, so this works regardless of how the command is invoked.
        const selection: TestItem[] = [];
        for (const a of args) {
            if (Array.isArray(a)) {
                for (const x of a) { if (x) { selection.push(x); } }
            } else if (a) {
                selection.push(a);
            }
        }

        // Flatten any file/suite nodes to their concrete tests, deduped (a parent and its
        // child could both be in the selection).
        const seen = new Set<string>();
        const concreteTests: TestItem[] = [];
        for (const sel of selection) {
            const acc: TestItem[] = [];
            collectRunnable(sel, acc);
            for (const t of acc) {
                if (t.uri && !seen.has(t.id)) { seen.add(t.id); concreteTests.push(t); }
            }
        }
        if (concreteTests.length === 0) {
            window.showInformationMessage('Select one or more tests to copy their reports.');
            return;
        }

        const fs = require('fs');

        // Resolve each test to its newest report (some may not have been run yet).
        const resolved = concreteTests.map((t) => ({
            label: t.label,
            reportPath: findReportHtml(path.join(path.dirname(t.uri!.fsPath), 'test-results', t.label))
        }));
        const withReport = resolved.filter((r) => r.reportPath);
        const missing = resolved.length - withReport.length;
        if (withReport.length === 0) {
            window.showInformationMessage('None of the selected tests have a report yet. Run them first.');
            return;
        }

        // Pick the destination folder once, defaulting to the folder used last time.
        const lastDir = context.globalState.get<string>('autoit-lsp.lastReportCopyDir');
        const picked = await window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Copy report(s) here',
            title: 'Copy Test Report(s) to folder',
            defaultUri: lastDir ? Uri.file(lastDir) : undefined
        });
        if (!picked || picked.length === 0) { return; }
        const destDir = picked[0].fsPath;

        // Name each copy after its test so consolidated reports stay distinguishable
        // (the source file is often just "report.html").
        const jobs = withReport.map((r) => {
            const safeLabel = r.label.replace(/[\\/:*?"<>|]/g, '_').trim() || 'report';
            const name = safeLabel + '.html';
            return { src: r.reportPath as string, dest: path.join(destDir, name), name };
        });

        // If any destinations already exist, ask once how to handle them.
        const existing = jobs.filter((j) => fs.existsSync(j.dest));
        let overwriteExisting = true;
        if (existing.length > 0) {
            const msg = existing.length === 1
                ? '"' + existing[0].name + '" already exists in that folder.'
                : existing.length + ' files already exist in that folder.';
            const choice = await window.showWarningMessage(msg + ' Overwrite?', { modal: true }, 'Overwrite', 'Skip existing');
            if (choice === undefined) { return; }               // cancelled
            overwriteExisting = (choice === 'Overwrite');
        }

        let copied = 0, skipped = 0, failed = 0;
        let firstCopied: string | undefined;
        for (const j of jobs) {
            if (fs.existsSync(j.dest) && !overwriteExisting) { skipped++; continue; }
            try {
                fs.copyFileSync(j.src, j.dest);
                copied++;
                if (!firstCopied) { firstCopied = j.dest; }
            } catch {
                failed++;
            }
        }

        context.globalState.update('autoit-lsp.lastReportCopyDir', destDir);

        const parts = ['Copied ' + copied + ' report' + (copied === 1 ? '' : 's') + ' to ' + destDir];
        if (skipped) { parts.push(skipped + ' skipped (already existed)'); }
        if (missing) { parts.push(missing + ' had no report'); }
        if (failed) { parts.push(failed + ' failed'); }
        const summary = parts.join('. ') + '.';

        const revealTarget = firstCopied || destDir;
        const reveal = await window.showInformationMessage(summary, 'Reveal');
        if (reveal === 'Reveal') {
            await commands.executeCommand('revealFileInOS', Uri.file(revealTarget));
        }
    });
    context.subscriptions.push(copyReportCmd);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
