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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const cdp_index_1 = require("./protocol/cdp-index");
const text_1 = require("./utils/text");
const cdp_mapper_1 = require("./protocol/cdp-mapper");
const autoit_api_1 = require("./autoit-api");
let cdpIndex;
function initializeCdp() {
    const schema = loadCdpSchema();
    cdpIndex = new cdp_index_1.CdpIndex(schema);
}
let cdpSchema = null;
function loadCdpSchema() {
    if (cdpSchema) {
        return cdpSchema;
    }
    const schemaPath = require.resolve("devtools-protocol/json/browser_protocol.json");
    const raw = fs.readFileSync(schemaPath, 'utf8');
    cdpSchema = JSON.parse(raw);
    return cdpSchema;
}
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
connection.onInitialize(() => {
    initializeCdp(); // ← THIS is the missing piece
    initializeAutoItApi();
    return {
        capabilities: {
            textDocumentSync: 1,
            completionProvider: { triggerCharacters: ['.', '_', '$'] },
            hoverProvider: true,
            signatureHelpProvider: { triggerCharacters: ['(', ','] }
        }
    };
});
connection.onHover(() => {
    return {
        contents: ["Hover info placeholder"]
    };
});
// Hand-maintained functions and keywords. These override same-named entries parsed from au3.api.
const AUTOIT_FUNCTIONS = [
    { name: "And", documentation: "", keyword: true, parameters: [] },
    { name: "ByRef", documentation: "", keyword: true, parameters: [] },
    { name: "Case", documentation: "", keyword: true, parameters: [] },
    { name: "Const", documentation: "", keyword: true, parameters: [] },
    { name: "ContinueCase", documentation: "", keyword: true, parameters: [] },
    { name: "ContinueLoop", documentation: "", keyword: true, parameters: [] },
    { name: "Default", documentation: "", keyword: true, parameters: [] },
    { name: "Dim", documentation: "", keyword: true, parameters: [] },
    { name: "Do", documentation: "", keyword: true, parameters: [] },
    { name: "Else", documentation: "", keyword: true, parameters: [] },
    { name: "ElseIf", documentation: "", keyword: true, parameters: [] },
    { name: "EndFunc", documentation: "", keyword: true, parameters: [] },
    { name: "EndIf", documentation: "", keyword: true, parameters: [] },
    { name: "EndSelect", documentation: "", keyword: true, parameters: [] },
    { name: "EndSwitch", documentation: "", keyword: true, parameters: [] },
    { name: "EndWith", documentation: "", keyword: true, parameters: [] },
    { name: "Enum", documentation: "", keyword: true, parameters: [] },
    { name: "Exit", documentation: "", keyword: true, parameters: [] },
    { name: "ExitLoop", documentation: "", keyword: true, parameters: [] },
    { name: "False", documentation: "", keyword: true, parameters: [] },
    { name: "For", documentation: "", keyword: true, parameters: [] },
    { name: "Func", documentation: "", keyword: true, parameters: [] },
    { name: "Global", documentation: "", keyword: true, parameters: [] },
    { name: "If", documentation: "", keyword: true, parameters: [] },
    { name: "In", documentation: "", keyword: true, parameters: [] },
    { name: "Local", documentation: "", keyword: true, parameters: [] },
    { name: "Next", documentation: "", keyword: true, parameters: [] },
    { name: "Not", documentation: "", keyword: true, parameters: [] },
    { name: "Null", documentation: "", keyword: true, parameters: [] },
    { name: "Or", documentation: "", keyword: true, parameters: [] },
    { name: "Redim", documentation: "", keyword: true, parameters: [] },
    { name: "Return", documentation: "", keyword: true, parameters: [] },
    { name: "Select", documentation: "", keyword: true, parameters: [] },
    { name: "Static", documentation: "", keyword: true, parameters: [] },
    { name: "Step", documentation: "", keyword: true, parameters: [] },
    { name: "Switch", documentation: "", keyword: true, parameters: [] },
    { name: "Then", documentation: "", keyword: true, parameters: [] },
    { name: "To", documentation: "", keyword: true, parameters: [] },
    { name: "True", documentation: "", keyword: true, parameters: [] },
    { name: "Until", documentation: "", keyword: true, parameters: [] },
    { name: "Volatile", documentation: "", keyword: true, parameters: [] },
    { name: "WEnd", documentation: "", keyword: true, parameters: [] },
    { name: "While", documentation: "", keyword: true, parameters: [] },
    { name: "With", documentation: "", keyword: true, parameters: [] },
    { name: "test", documentation: "Begins a named test.",
        parameters: [
            { label: "name", documentation: "Name of the test." }
        ]
    },
    { name: "teststep", documentation: "Begins a named test step.",
        parameters: [
            { label: "name", documentation: "Name of the test step." }
        ]
    }
];
// Signatures for dotted method calls: $cdp.browser.launch(, $chrome.newPage(, etc.
const METHOD_SIGNATURES_LIST = [
    {
        name: "exists",
        label: "exists(port)",
        documentation: "Returns if a browser exists for the given port.",
        parameters: [
            { label: "port", documentation: "port number of the browser" },
        ]
    },
    {
        name: "launch",
        label: "launch(browser = $CDPBROWSER_CHROME, jOptions = Null)",
        documentation: "Launches a browser and returns a Browser object.",
        parameters: [
            { label: "browser", documentation: "Browser enum or path to browser executable." },
            { label: "jOptions", documentation: "Optional JSON-like object with launch options (port, startupSwitches, profile, windowSize, clearCookies, version)." }
        ]
    },
    {
        name: "isRunning",
        label: "isRunning(port)",
        documentation: "Returns if a browser is running on the given port.",
        parameters: [
            { label: "port", documentation: "port number of the browser" },
        ]
    },
    {
        name: "forceClose",
        label: "forceClose(port)",
        documentation: "Forecfully closes a browser on the given port.",
        parameters: [
            { label: "port", documentation: "port number of the browser" },
        ]
    },
    {
        name: "goto",
        label: "goto(url, waitForLoad = True)",
        documentation: "Navigate to a url.",
        parameters: [
            { label: "url", documentation: "the url." },
            { label: "waitForLoad", documentation: "wait for page to be loaded." }
        ]
    },
    {
        name: "locator",
        label: "locator(selector)",
        documentation: "Locate a page element.",
        parameters: [
            { label: "selector", documentation: "the selector of the element." },
        ]
    },
    {
        name: "evaluate",
        label: "evaluate(expression)",
        documentation: "Evaluate an expression.",
        parameters: [
            { label: "expression", documentation: "the expression." },
        ]
    },
    {
        name: "setContent",
        label: "setContent(html)",
        documentation: "Sets the content of the page.",
        parameters: [
            { label: "html", documentation: "the html content." },
        ]
    },
    {
        name: "waitForLoad",
        label: "waitForLoad(timeout = $cdp.config.timeout)",
        documentation: "Waits for the page to be loaded.",
        parameters: [
            { label: "timeout", documentation: "an optional timeout." },
        ]
    },
    {
        name: "screenshot",
        label: "screenshot(path, fullPage = True)",
        documentation: "Takes a screenshot of the page.",
        parameters: [
            { label: "path", documentation: "the file to output the screenshot to." },
            { label: "fullPage", documentation: "is the screenshot full page?" },
        ]
    },
    {
        name: "waitForSelector",
        label: "waitForSelector(selector, state = $CDPSTATE_ATTACHED, timeout = $cdp.config.timeout)",
        documentation: "Waits for a selector on the page.",
        parameters: [
            { label: "selector", documentation: "the selector." },
            { label: "state", documentation: "$CDPSTATE_ATTACHED" },
            { label: "timeout", documentation: "an optional timeout." },
        ]
    },
    {
        name: "click",
        label: "click(waitForLoad = False)",
        documentation: "Click the element.",
        parameters: [
            { label: "waitForLoad", documentation: "wait for page to be loaded." }
        ]
    },
    {
        name: "clickAt",
        label: "clickAt(offsetX, offsetY)",
        documentation: "Click at an offset from the top-left of the element.",
        parameters: [
            { label: "offsetX", documentation: "the X offset from the top-left." },
            { label: "offsetY", documentation: "the Y offset from the top-left." }
        ]
    },
    {
        name: "dblClick",
        label: "dblClick(waitForLoad = False)",
        documentation: "Double click the element.",
        parameters: [
            { label: "waitForLoad", documentation: "wait for page to be loaded." }
        ]
    },
    {
        name: "fill",
        label: "fill(value)",
        documentation: "Set a value to the input field.",
        parameters: [
            { label: "value", documentation: "the value to set." }
        ]
    },
    {
        name: "sendKeys",
        label: "sendKeys(text, delay = 0)",
        documentation: "Enters text into a field via simulated keystrokes.",
        parameters: [
            { label: "text", documentation: "the text to enter." },
            { label: "delay", documentation: "an optional delay between keystrokes." },
        ]
    },
    {
        name: "setChecked",
        label: "setChecked(state)",
        documentation: "Set the state of a checkbox or a radio element.",
        parameters: [
            { label: "state", documentation: "Whether to check or uncheck the checkbox." },
        ]
    },
    {
        name: "selectOption",
        label: "selectOption(value)",
        documentation: "Selects option or options in <select>.",
        parameters: [
            { label: "value", documentation: "Option to select." },
        ]
    },
    {
        name: "getAttribute",
        label: "getAttribute(name)",
        documentation: "Returns the matching element's attribute value.",
        parameters: [
            { label: "name", documentation: "Attribute name to get the value for." },
        ]
    },
    {
        name: "screenshot",
        label: "screenshot(path = \"\")",
        documentation: "Take a screenshot of the element.",
        parameters: [
            { label: "path", documentation: "Optional file path to save the image to." },
        ]
    },
    {
        name: "waitFor",
        label: "waitFor(state = $CDPSTATE_VISIBLE, timeout = $cdp.config.timeout)",
        documentation: "Returns when element specified by locator satisfies the state option.",
        parameters: [
            { label: "state", documentation: "$CDPSTATE_ATTACHED | $CDPSTATE_DETACHED | $CDPSTATE_VISIBLE | $CDPSTATE_HIDDEN" },
            { label: "timeout", documentation: "an optional timeout." },
        ]
    },
];
// AutoIt is case-insensitive, so key lookups on the lowercased name.
// Duplicate names (e.g. page screenshot vs element screenshot) become overloads.
const METHOD_SIGNATURES = new Map();
for (const f of METHOD_SIGNATURES_LIST) {
    const key = f.name.toLowerCase();
    const overloads = METHOD_SIGNATURES.get(key);
    if (overloads) {
        overloads.push(f);
    }
    else {
        METHOD_SIGNATURES.set(key, [f]);
    }
}
// name (lowercased) → overloads. Built from au3.api plus AUTOIT_FUNCTIONS; keywords excluded.
let functionSignatures = new Map();
// Completion items for every known function and keyword, built once at startup.
let functionCompletionItems = [];
function loadAu3ApiEntries() {
    // The compiled server runs from out/server/; au3.api lives at the extension root.
    const candidates = [
        path.join(__dirname, '..', '..', 'au3.api'),
        path.join(__dirname, 'au3.api')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return (0, autoit_api_1.parseAu3Api)(candidate);
        }
    }
    connection.console.warn(`au3.api not found, built-in function IntelliSense limited to hand-maintained entries (looked in: ${candidates.join(', ')})`);
    return [];
}
function initializeAutoItApi() {
    const byName = new Map();
    for (const fn of loadAu3ApiEntries()) {
        const key = fn.name.toLowerCase();
        const overloads = byName.get(key);
        if (overloads) {
            overloads.push(fn);
        }
        else {
            byName.set(key, [fn]);
        }
    }
    for (const fn of AUTOIT_FUNCTIONS) {
        byName.set(fn.name.toLowerCase(), [fn]);
    }
    functionSignatures = new Map();
    functionCompletionItems = [];
    for (const overloads of byName.values()) {
        const fn = overloads[0];
        if (fn.keyword) {
            functionCompletionItems.push({
                label: fn.name,
                kind: node_1.CompletionItemKind.Keyword,
                detail: `${fn.name} (keyword)`,
                documentation: fn.documentation,
                insertText: fn.name + " "
            });
            continue;
        }
        functionSignatures.set(fn.name.toLowerCase(), overloads);
        functionCompletionItems.push({
            label: fn.name,
            kind: node_1.CompletionItemKind.Function,
            detail: overloads.length > 1
                ? `${buildSignatureLabel(fn)} (+${overloads.length - 1} more)`
                : buildSignatureLabel(fn),
            documentation: fn.documentation,
            insertText: fn.name + "(",
            command: {
                command: "editor.action.triggerParameterHints",
                title: "Trigger Parameter Hints"
            }
        });
    }
}
function buildSignatureLabel(fn) {
    return fn.label ?? `${fn.name}(${fn.parameters.map(p => p.label).join(", ")})`;
}
// Make each method completion insert a call. Methods with known parameters (a METHOD_SIGNATURES
// entry with at least one parameter) insert "name(" and pop parameter hints; the rest insert a
// completed "name()" since there is nothing to enter.
function withCallParens(items) {
    return items.map(item => {
        const overloads = METHOD_SIGNATURES.get(item.label.toLowerCase());
        const hasParameters = overloads?.some(o => o.parameters.length > 0) ?? false;
        if (!hasParameters) {
            return { ...item, insertText: item.label + "()" };
        }
        return {
            ...item,
            insertText: item.label + "(",
            command: {
                command: "editor.action.triggerParameterHints",
                title: "Trigger Parameter Hints"
            }
        };
    });
}
// Finds the call the cursor is inside by scanning backwards for the first unmatched "(".
// isMethod is true when the call is dotted (e.g. "$cdp.browser.launch("), false for a bare call ("teststep(").
function findEnclosingCall(before) {
    let depth = 0;
    for (let i = before.length - 1; i >= 0; i--) {
        const ch = before[i];
        if (ch === ')') {
            depth++;
            continue;
        }
        if (ch === '(') {
            if (depth > 0) {
                depth--;
                continue;
            }
            const head = before.slice(0, i);
            const m = /(\.?)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(head);
            if (!m)
                return null;
            return { name: m[2], openParen: i, isMethod: m[1] === '.' };
        }
    }
    return null;
}
// Count top-level commas (ignore commas inside nested parens or quotes)
function countTopLevelCommas(argsText) {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let escape = false;
    let commas = 0;
    for (let i = 0; i < argsText.length; i++) {
        const ch = argsText[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === '\\') {
            escape = true;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (inSingle || inDouble)
            continue;
        if (ch === '(') {
            depth++;
            continue;
        }
        if (ch === ')') {
            if (depth > 0)
                depth--;
            continue;
        }
        if (ch === ',' && depth === 0) {
            commas++;
        }
    }
    return commas;
}
connection.onSignatureHelp((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return null;
    const text = doc.getText();
    const offset = doc.offsetAt(params.position);
    const before = text.slice(0, offset);
    const call = findEnclosingCall(before);
    if (!call)
        return null;
    const registry = call.isMethod ? METHOD_SIGNATURES : functionSignatures;
    const overloads = registry.get(call.name.toLowerCase());
    if (!overloads || overloads.length === 0)
        return null;
    const commas = countTopLevelCommas(text.slice(call.openParen + 1, offset));
    // Prefer the first overload with enough parameters for the argument currently being typed.
    let active = overloads.findIndex(o => o.parameters.length > commas);
    if (active === -1)
        active = overloads.length - 1;
    return {
        signatures: overloads.map(fn => ({
            label: buildSignatureLabel(fn),
            documentation: fn.documentation,
            parameters: fn.parameters
        })),
        activeSignature: active,
        activeParameter: Math.min(commas, Math.max(overloads[active].parameters.length - 1, 0))
    };
});
const LOCATOR_METHODS = [
    "objectToNode",
    "click",
    "clickAt",
    "dblClick",
    "hover",
    "tap",
    "fill",
    "sendKeys",
    "press",
    "check",
    "uncheck",
    "setChecked",
    "selectOption",
    "focus",
    "blur",
    "clear",
    "dragTo",
    "setInputFiles",
    "dispatchEvent",
    "scrollIntoView",
    "scrollIntoViewIfNeeded",
    "textContent",
    "innerText",
    "innerTextCRStripped",
    "innerTextLFStripped",
    "innerTextReplace",
    "innerHTML",
    "inputValue",
    "getAttribute",
    "boundingBox",
    "screenshot",
    "evaluate",
    "evaluateAll",
    "elementHandle",
    "allInnerTexts",
    "allTextContents",
    "count",
    "isVisible",
    "isHidden",
    "isEnabled",
    "isDisabled",
    "isEditable",
    "isChecked",
    "waitFor",
    "waitForElementState",
    "waitForSelector",
    "filter",
    "nth",
    "first",
    "last",
    "getByRole",
    "getByText",
    "getByLabel",
    "getByPlaceholder",
    "getByAltText",
    "getByTitle",
    "getByTestId"
];
connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return [];
    const text = doc.getText();
    const offset = doc.offsetAt(params.position);
    const before = text.slice(0, offset);
    // IntelliSense for Locator object methods after .locator(...).
    if (/\.locator\([^)]*\)\.$/i.test(before)) {
        return withCallParens(LOCATOR_METHODS.map(name => ({
            label: name,
            kind: node_1.CompletionItemKind.Method
        })));
    }
    const prefix = (0, text_1.getPrefix)(text, offset);
    // IntelliSense for typing the $browser persistent global variable
    if (/^\$[A-Za-z0-9_]*$/i.test(prefix)) {
        const range = {
            start: doc.positionAt(offset - prefix.length),
            end: doc.positionAt(offset)
        };
        return [
            {
                label: "$browser",
                kind: node_1.CompletionItemKind.Variable,
                detail: "Persistent global variable",
                documentation: "Persistent browser handle",
                textEdit: node_1.TextEdit.replace(range, "$browser."),
                command: {
                    command: "editor.action.triggerSuggest",
                    title: "Trigger Suggest"
                }
            },
            {
                label: "$config",
                kind: node_1.CompletionItemKind.Variable,
                detail: "Persistent global variable",
                documentation: "Persistent config handle",
                textEdit: node_1.TextEdit.replace(range, "$config."),
                command: {
                    command: "editor.action.triggerSuggest",
                    title: "Trigger Suggest"
                }
            },
            {
                label: "$api",
                kind: node_1.CompletionItemKind.Variable,
                detail: "Persistent global variable",
                documentation: "Persistent api handle",
                textEdit: node_1.TextEdit.replace(range, "$api."),
                command: {
                    command: "editor.action.triggerSuggest",
                    title: "Trigger Suggest"
                }
            },
            {
                label: "$cdp",
                kind: node_1.CompletionItemKind.Variable,
                detail: "Persistent global variable",
                documentation: "Persistent CDP handle",
                textEdit: node_1.TextEdit.replace(range, "$cdp."),
                command: {
                    command: "editor.action.triggerSuggest",
                    title: "Trigger Suggest"
                }
            }
        ];
    }
    // IntelliSense for $cdp.<property>
    if (before.endsWith("$cdp.")) {
        return [
            {
                label: "state", kind: node_1.CompletionItemKind.Property, detail: "$cdp.state", documentation: "CDP runtime state (connected, sessionId, browserPid, etc.)"
            },
            {
                label: "config", kind: node_1.CompletionItemKind.Property, detail: "$cdp.config", documentation: "Configuration values for CDP UDF",
                insertText: "config.", command: { command: "editor.action.triggerSuggest", title: "Trigger Suggest" }
            },
            {
                label: "browser", kind: node_1.CompletionItemKind.Property, detail: "$cdp.browser", documentation: "Browser-level operations",
                insertText: "browser.", command: { command: "editor.action.triggerSuggest", title: "Trigger Suggest" }
            },
            {
                label: "api", kind: node_1.CompletionItemKind.Property, detail: "$cdp.api", documentation: "AutoIt wrapper for CDP commands",
                insertText: "api.", command: { command: "editor.action.triggerSuggest", title: "Trigger Suggest" }
            }
        ];
    }
    if (/^\$cdp\.state\.$/i.test(prefix)) {
        return [
            { label: "indentLevel", kind: 5, detail: "int", documentation: "indentation level" },
            { label: "events", kind: 5, detail: "dictionary", documentation: "dictionary of events" }
        ];
    }
    function isLocatorObjectCall(text, offset) {
        const before = text.slice(0, offset);
        if (!before.endsWith('.')) {
            return false;
        }
        let i = before.length - 2;
        let depth = 0;
        while (i >= 0) {
            const ch = before[i];
            if (ch === ')') {
                depth++;
            }
            else if (ch === '(') {
                if (depth <= 1) {
                    break;
                }
                depth--;
            }
            i--;
        }
        if (i <= 0) {
            return false;
        }
        const prefix = before.slice(0, i);
        return /\.\s*locator\s*$/i.test(prefix);
    }
    if (isLocatorObjectCall(text, offset)) {
        return withCallParens([
            { label: "objectToNode", kind: node_1.CompletionItemKind.Method, detail: "Convert to node", documentation: "Returns the DOM node corresponding to this locator." },
            { label: "click", kind: node_1.CompletionItemKind.Method, detail: "Click element", documentation: "Clicks the matched element." },
            { label: "clickAt", kind: node_1.CompletionItemKind.Method, detail: "Click at", documentation: "Clicks the element at a specific location." },
            { label: "dblClick", kind: node_1.CompletionItemKind.Method, detail: "Double click", documentation: "Double-clicks the matched element." },
            { label: "hover", kind: node_1.CompletionItemKind.Method, detail: "Hover element", documentation: "Moves the mouse over the matched element." },
            { label: "tap", kind: node_1.CompletionItemKind.Method, detail: "Tap element", documentation: "Taps the matched element on touch-capable devices." },
            { label: "fill", kind: node_1.CompletionItemKind.Method, detail: "Fill input", documentation: "Fills the matched input element." },
            { label: "sendKeys", kind: node_1.CompletionItemKind.Method, detail: "Send keys", documentation: "Sends keystrokes to the matched element." },
            { label: "press", kind: node_1.CompletionItemKind.Method, detail: "Press key", documentation: "Presses a key while the element is focused." },
            { label: "check", kind: node_1.CompletionItemKind.Method, detail: "Check checkbox", documentation: "Checks the matched checkbox." },
            { label: "uncheck", kind: node_1.CompletionItemKind.Method, detail: "Uncheck checkbox", documentation: "Unchecks the matched checkbox." },
            { label: "setChecked", kind: node_1.CompletionItemKind.Method, detail: "Set checked state", documentation: "Sets the checked state of the matched checkbox." },
            { label: "selectOption", kind: node_1.CompletionItemKind.Method, detail: "Select option", documentation: "Selects an option in a select element." },
            { label: "focus", kind: node_1.CompletionItemKind.Method, detail: "Focus element", documentation: "Focuses the matched element." },
            { label: "blur", kind: node_1.CompletionItemKind.Method, detail: "Blur element", documentation: "Removes focus from the matched element." },
            { label: "clear", kind: node_1.CompletionItemKind.Method, detail: "Clear field", documentation: "Clears the value of the matched element." },
            { label: "dragTo", kind: node_1.CompletionItemKind.Method, detail: "Drag element", documentation: "Drags the element to another target." },
            { label: "setInputFiles", kind: node_1.CompletionItemKind.Method, detail: "Set input files", documentation: "Sets files for a file input element." },
            { label: "dispatchEvent", kind: node_1.CompletionItemKind.Method, detail: "Dispatch event", documentation: "Dispatches a DOM event on the element." },
            { label: "scrollIntoView", kind: node_1.CompletionItemKind.Method, detail: "Scroll into view", documentation: "Scrolls the element into view." },
            { label: "scrollIntoViewIfNeeded", kind: node_1.CompletionItemKind.Method, detail: "Scroll into view if needed", documentation: "Scrolls the element into view if it is not already visible." },
            { label: "textContent", kind: node_1.CompletionItemKind.Method, detail: "Text content", documentation: "Returns the text content of the element." },
            { label: "innerText", kind: node_1.CompletionItemKind.Method, detail: "Inner text", documentation: "Returns the inner text of the element." },
            { label: "innerTextCRStripped", kind: node_1.CompletionItemKind.Method, detail: "Inner text CR stripped", documentation: "Returns inner text with CR characters stripped." },
            { label: "innerTextLFStripped", kind: node_1.CompletionItemKind.Method, detail: "Inner text LF stripped", documentation: "Returns inner text with LF characters stripped." },
            { label: "innerTextReplace", kind: node_1.CompletionItemKind.Method, detail: "Inner text replace", documentation: "Returns inner text with replacements applied." },
            { label: "innerHTML", kind: node_1.CompletionItemKind.Method, detail: "Inner HTML", documentation: "Returns the inner HTML of the element." },
            { label: "inputValue", kind: node_1.CompletionItemKind.Method, detail: "Input value", documentation: "Returns the value of the input element." },
            { label: "getAttribute", kind: node_1.CompletionItemKind.Method, detail: "Get attribute", documentation: "Gets an attribute value from the element." },
            { label: "boundingBox", kind: node_1.CompletionItemKind.Method, detail: "Bounding box", documentation: "Returns the element's bounding box." },
            { label: "screenshot", kind: node_1.CompletionItemKind.Method, detail: "Screenshot element", documentation: "Takes a screenshot of the element." },
            { label: "evaluate", kind: node_1.CompletionItemKind.Method, detail: "Evaluate script", documentation: "Evaluates JavaScript in the page context on this locator." },
            { label: "evaluateAll", kind: node_1.CompletionItemKind.Method, detail: "Evaluate all", documentation: "Evaluates JavaScript across all matched elements." },
            { label: "elementHandle", kind: node_1.CompletionItemKind.Method, detail: "Element handle", documentation: "Returns the element handle for the matched element." },
            { label: "allInnerTexts", kind: node_1.CompletionItemKind.Method, detail: "All inner texts", documentation: "Gets inner texts of all matched elements." },
            { label: "allTextContents", kind: node_1.CompletionItemKind.Method, detail: "All text contents", documentation: "Gets text contents of all matched elements." },
            { label: "count", kind: node_1.CompletionItemKind.Method, detail: "Count elements", documentation: "Returns the number of matched elements." },
            { label: "isVisible", kind: node_1.CompletionItemKind.Method, detail: "Is visible", documentation: "Returns true if the element is visible." },
            { label: "isHidden", kind: node_1.CompletionItemKind.Method, detail: "Is hidden", documentation: "Returns true if the element is hidden." },
            { label: "isEnabled", kind: node_1.CompletionItemKind.Method, detail: "Is enabled", documentation: "Returns true if the element is enabled." },
            { label: "isDisabled", kind: node_1.CompletionItemKind.Method, detail: "Is disabled", documentation: "Returns true if the element is disabled." },
            { label: "isEditable", kind: node_1.CompletionItemKind.Method, detail: "Is editable", documentation: "Returns true if the element is editable." },
            { label: "isChecked", kind: node_1.CompletionItemKind.Method, detail: "Is checked", documentation: "Returns true if the element is checked." },
            { label: "waitFor", kind: node_1.CompletionItemKind.Method, detail: "Wait for", documentation: "Waits for the locator to satisfy the given state." },
            { label: "waitForElementState", kind: node_1.CompletionItemKind.Method, detail: "Wait for element state", documentation: "Waits for the element to reach the given state." },
            { label: "waitForSelector", kind: node_1.CompletionItemKind.Method, detail: "Wait for selector", documentation: "Waits for a selector relative to this locator." },
            { label: "filter", kind: node_1.CompletionItemKind.Method, detail: "Filter locator", documentation: "Filters matched elements." },
            { label: "nth", kind: node_1.CompletionItemKind.Method, detail: "Nth element", documentation: "Selects the nth matched element." },
            { label: "first", kind: node_1.CompletionItemKind.Method, detail: "First element", documentation: "Selects the first matched element." },
            { label: "last", kind: node_1.CompletionItemKind.Method, detail: "Last element", documentation: "Selects the last matched element." },
            { label: "getByRole", kind: node_1.CompletionItemKind.Method, detail: "Get by role", documentation: "Returns locator by ARIA role." },
            { label: "getByText", kind: node_1.CompletionItemKind.Method, detail: "Get by text", documentation: "Returns locator by text." },
            { label: "getByLabel", kind: node_1.CompletionItemKind.Method, detail: "Returns locator by label." },
            { label: "getByPlaceholder", kind: node_1.CompletionItemKind.Method, detail: "Returns locator by placeholder text." },
            { label: "getByAltText", kind: node_1.CompletionItemKind.Method, detail: "Returns locator by alt text." },
            { label: "getByTitle", kind: node_1.CompletionItemKind.Method, detail: "Returns locator by title." },
            { label: "getByTestId", kind: node_1.CompletionItemKind.Method, detail: "Returns locator by test id." }
        ]);
    }
    if (before.endsWith("$cdp.browser.") || /\$browser\.$/i.test(before)) {
        return withCallParens([
            { label: "exists", kind: 2, detail: "Test browser exists", documentation: "Returns if a browser exists" },
            { label: "launch", kind: 2, detail: "Launch browser", documentation: "Starts Chrome/Edge with CDP enabled" },
            { label: "isRunning", kind: 2, detail: "Test browser is running", documentation: "Returns if a browser is running" },
            { label: "forceClose", kind: 2, detail: "Close browser", documentation: "Forcefully closes the browser" },
        ]);
    }
    if (before.endsWith("$cdp.api.") || /\$api\.$/i.test(before)) {
        return withCallParens([
            { label: "get", kind: 2, detail: "HTTP GET", documentation: "GET request" },
            { label: "post", kind: 2, detail: "HTTP POST", documentation: "POST request" },
            { label: "put", kind: 2, detail: "HTTP PUT", documentation: "PUT request" },
            { label: "patch", kind: 2, detail: "HTTP PATCH", documentation: "PATCH request" },
            { label: "delete", kind: 2, detail: "HTTP DELETE", documentation: "DELETE request" },
        ]);
    }
    if (before.endsWith("$cdp.config.") || /\$config\.$/i.test(before)) {
        return [
            { label: "timeout", kind: 5, detail: "int", documentation: "Default timeout for CDP commands" },
            { label: "debug", kind: 5, detail: "bool", documentation: "Debugging enabled" },
            { label: "infoPopups", kind: 5, detail: "bool", documentation: "Information popups enabled" },
            { label: "errorPopups", kind: 5, detail: "bool", documentation: "Error popups enabled" },
            { label: "enterpriseMode", kind: 5, detail: "bool", documentation: "Enterprise mode enabled" },
            { label: "video", kind: 5, detail: "enum", documentation: "$CDPVIDEO_OFF or $CDPVIDEO_ON" },
        ];
    }
    function isPageHandleVariableName(variableName) {
        return /page/i.test(variableName);
    }
    function isBrowserHandleVariableName(variableName) {
        return /(chrome|chromium|edge|firefox|browser|webkit|safari)/i.test(variableName);
    }
    const browserHandleMatch = /^\$([A-Za-z0-9_]+)\.$/.exec(prefix);
    if (browserHandleMatch) {
        const variableName = browserHandleMatch[1];
        if (isPageHandleVariableName(variableName)) {
            return withCallParens([
                { label: "goto", kind: 2, detail: "Navigate page", documentation: "Navigates the page to a new URL" },
                { label: "locator", kind: 2, detail: "Query selector", documentation: "Returns a locator for the given selector" },
                { label: "evaluate", kind: 2, detail: "Run script", documentation: "Evaluates JavaScript in the page context" },
                { label: "bringToFront", kind: 2, detail: "Focus page", documentation: "Brings the page to the front" },
                { label: "setContent", kind: 2, detail: "Set HTML", documentation: "Sets the full HTML content of the page" },
                { label: "waitForLoad", kind: 2, detail: "Wait for load", documentation: "Waits for the page to finish loading" },
                { label: "screenshot", kind: 2, detail: "Capture screenshot", documentation: "Takes a screenshot of the page" },
                { label: "url", kind: 2, detail: "Page URL", documentation: "Gets the current page URL" },
                { label: "title", kind: 2, detail: "Page title", documentation: "Gets the current page title" },
                { label: "content", kind: 2, detail: "Page content", documentation: "Gets the page HTML content" },
                { label: "viewportSize", kind: 2, detail: "Viewport size", documentation: "Gets or sets the viewport size" },
                { label: "waitForSelector", kind: 2, detail: "Wait for selector", documentation: "Waits for an element matching a selector" }
            ]);
        }
        if (isBrowserHandleVariableName(variableName)) {
            return withCallParens([
                { label: "newPage", kind: 2, detail: "Create a new page", documentation: "Creates a new page from the browser object" },
                { label: "getNewPage", kind: 2, detail: "Get a new page", documentation: "Returns a new BrowserPage wrapper" },
                { label: "close", kind: 2, detail: "Close browser", documentation: "Closes the browser and all pages" }
            ]);
        }
    }
    // bare identifier being typed (e.g. "t", "tes") → offer function and keyword names
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
        return functionCompletionItems;
    }
    // Match CDP.<Domain>.
    const match = /^CDP\.([A-Za-z0-9]+)\.$/.exec(prefix);
    if (!match) {
        return [];
    }
    const domainName = match[1];
    const commands = cdpIndex.listCommandsForDomain(domainName);
    if (!commands || commands.length === 0) {
        return [];
    }
    return commands.map(cmd => ({
        label: cmd.name,
        kind: 2,
        detail: `${domainName}.${cmd.name} → ${(0, cdp_mapper_1.toAutoItFunctionName)(domainName, cmd.name)}`,
        documentation: cmd.description ?? ''
    }));
});
documents.listen(connection);
connection.listen();
//# sourceMappingURL=server.js.map