"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const vscode_1 = require("vscode");
const node_1 = require("vscode-languageclient/node");
let client;
let runningProcesses = [];
const isWindows = process.platform === 'win32';
function activate(context) {
    const serverModule = context.asAbsolutePath(path.join('out', 'server', 'server.js'));
    const serverOptions = {
        run: { module: serverModule, transport: node_1.TransportKind.ipc },
        debug: { module: serverModule, transport: node_1.TransportKind.ipc }
    };
    const clientOptions = {
        documentSelector: [{ scheme: 'file', language: 'autoit' }],
        synchronize: {
            fileEvents: vscode_1.workspace.createFileSystemWatcher('**/.clientrc')
        }
    };
    client = new node_1.LanguageClient('autoitLanguageServer', 'AutoIt Language Server', serverOptions, clientOptions);
    client.start();
    // Output channel for run/check
    const out = vscode_1.window.createOutputChannel('AutoIt');
    context.subscriptions.push(out);
    // Status bar Run/Stop buttons, shown while an AutoIt editor is active or a script is running
    const runButton = vscode_1.window.createStatusBarItem(vscode_1.StatusBarAlignment.Left, 100);
    runButton.text = '$(play) Run AutoIt';
    runButton.tooltip = 'Run the current AutoIt script (F5)';
    runButton.command = 'autoit-lsp.runScript';
    const stopButton = vscode_1.window.createStatusBarItem(vscode_1.StatusBarAlignment.Left, 99);
    stopButton.text = '$(debug-stop) Stop';
    stopButton.tooltip = 'Stop running AutoIt scripts (Ctrl+Break)';
    stopButton.command = 'autoit-lsp.stopScript';
    context.subscriptions.push(runButton, stopButton);
    function updateStatusBarButtons() {
        const isAutoItEditor = vscode_1.window.activeTextEditor?.document.languageId === 'autoit';
        if (isAutoItEditor || runningProcesses.length > 0) {
            runButton.show();
            stopButton.show();
        }
        else {
            runButton.hide();
            stopButton.hide();
        }
    }
    updateStatusBarButtons();
    context.subscriptions.push(vscode_1.window.onDidChangeActiveTextEditor(updateStatusBarButtons));
    function killRunningProcesses() {
        if (runningProcesses.length === 0) {
            out.appendLine('No AutoIt processes are currently running.');
            return;
        }
        out.appendLine('Stopping AutoIt processes...');
        runningProcesses.forEach((proc) => {
            try {
                if (isWindows) {
                    const kill = require('child_process').spawn('taskkill', ['/PID', proc.pid.toString(), '/T', '/F']);
                    kill.on('close', (code) => {
                        out.appendLine(`taskkill exited with code ${code}`);
                    });
                }
                else {
                    proc.kill('SIGTERM');
                }
            }
            catch (err) {
                out.appendLine(`Failed to stop process ${proc.pid}: ${err.message}`);
            }
        });
        runningProcesses = [];
        updateStatusBarButtons();
    }
    // Register run command (F5)
    const runCmd = vscode_1.commands.registerCommand('autoit-lsp.runScript', async () => {
        const editor = vscode_1.window.activeTextEditor;
        if (!editor) {
            vscode_1.window.showErrorMessage('No active editor to run');
            return;
        }
        const doc = editor.document;
        if (doc.isUntitled) {
            vscode_1.window.showErrorMessage('Please save the script before running.');
            return;
        }
        // Save the document first
        await doc.save();
        const filePath = doc.fileName;
        const cfg = vscode_1.workspace.getConfiguration('autoit');
        const checkPath = cfg.get('checkPath') || 'C:\\Program Files (x86)\\AutoIt3\\Au3Check.exe';
        // Prefer the 32-bit AutoIt runtime (AutoIt3.exe) if present — SciTe uses it by default.
        const configuredRunner = cfg.get('runnerPath');
        const default32 = 'C:\\Program Files (x86)\\AutoIt3\\AutoIt3.exe';
        const default64 = 'C:\\Program Files (x86)\\AutoIt3\\autoit3_x64.exe';
        const fs = require('fs');
        let runnerPath = configuredRunner || '';
        if (!runnerPath) {
            if (fs.existsSync(default32))
                runnerPath = default32;
            else
                runnerPath = default64;
        }
        out.clear();
        out.show(true);
        //out.appendLine(`Running Au3Check: ${checkPath} ${filePath}`);
        const { spawn } = require('child_process');
        const childOptions = { cwd: path.dirname(filePath), env: process.env };
        function streamProcess(cmd, args, onClose) {
            try {
                const p = spawn(cmd, args, childOptions);
                runningProcesses.push(p);
                updateStatusBarButtons();
                p.stdout.on('data', (chunk) => out.append(chunk.toString()));
                p.stderr.on('data', (chunk) => out.append(chunk.toString()));
                p.on('error', (err) => out.appendLine(`Failed to start ${cmd}: ${err.message}`));
                p.on('close', (code) => {
                    out.appendLine(`${path.basename(cmd)} exited with code ${code}`);
                    runningProcesses = runningProcesses.filter((proc) => proc !== p);
                    updateStatusBarButtons();
                    if (onClose)
                        onClose(code);
                });
                return p;
            }
            catch (e) {
                out.appendLine(`Error spawning ${cmd}: ${e.message}`);
                if (onClose)
                    onClose?.(1);
                return null;
            }
        }
        //out.appendLine(`Spawning Au3Check: ${checkPath} ${filePath}`);
        if (fs.existsSync(checkPath)) {
            streamProcess(checkPath, [filePath], (code) => {
                // After check completes, run AutoIt regardless of exit code to match SciTe behavior
                out.appendLine(`Spawning AutoIt: ${runnerPath} "${filePath}" (cwd: ${childOptions.cwd})`);
                streamProcess(runnerPath, [filePath]);
            });
        }
        else {
            out.appendLine(`Au3Check not found at ${checkPath}, skipping check.`);
            out.appendLine(`Spawning AutoIt: ${runnerPath} "${filePath}" (cwd: ${childOptions.cwd})`);
            streamProcess(runnerPath, [filePath]);
        }
    });
    context.subscriptions.push(runCmd);
    // Register 'Go' command that delegates to the same runner (used from menu)
    const goCmd = vscode_1.commands.registerCommand('autoit-lsp.go', async () => {
        await vscode_1.commands.executeCommand('autoit-lsp.runScript');
    });
    context.subscriptions.push(goCmd);
    // Register 'Start Debugging' command for Run menu to mimic SciTe's Start Debugging
    const startDebugCmd = vscode_1.commands.registerCommand('autoit-lsp.startDebug', async () => {
        await vscode_1.commands.executeCommand('autoit-lsp.runScript');
    });
    context.subscriptions.push(startDebugCmd);
    // Register 'Start AutoIt' command (explicit non-debug run from Run menu)
    const startAutoItCmd = vscode_1.commands.registerCommand('autoit-lsp.startAutoIt', async () => {
        await vscode_1.commands.executeCommand('autoit-lsp.runScript');
    });
    context.subscriptions.push(startAutoItCmd);
    const stopCmd = vscode_1.commands.registerCommand('autoit-lsp.stopScript', async () => {
        killRunningProcesses();
    });
    context.subscriptions.push(stopCmd);
}
function deactivate() {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
//# sourceMappingURL=extension.js.map