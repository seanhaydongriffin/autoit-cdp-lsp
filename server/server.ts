import * as fs from 'fs';
import * as path from 'path';
import { CdpSchema } from './protocol/cdp-types';
import { CdpIndex } from './protocol/cdp-index';
import { getPrefix } from './utils/text';
import { toAutoItFunctionName } from './protocol/cdp-mapper';
import { FunctionSignature, parseAu3Api } from './autoit-api';


let cdpIndex: CdpIndex;

function initializeCdp() {
    const schema = loadCdpSchema();
    cdpIndex = new CdpIndex(schema);
}

let cdpSchema: CdpSchema | null = null;

function loadCdpSchema(): CdpSchema {
    if (cdpSchema) {
        return cdpSchema;
    }

    const schemaPath = require.resolve("devtools-protocol/json/browser_protocol.json");
    const raw = fs.readFileSync(schemaPath, 'utf8');
    cdpSchema = JSON.parse(raw) as CdpSchema;
    return cdpSchema;
}


import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    CompletionItem,
    CompletionItemKind,
    Hover,
    SignatureHelp,
    TextEdit
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

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
    } as Hover;
});

// Hand-maintained functions and keywords. These override same-named entries parsed from au3.api.
const AUTOIT_FUNCTIONS: FunctionSignature[] = [
    { name: "With", documentation: "", keyword: true,
        parameters: [] 
    },
    { name: "test", documentation: "Begins a named test.",
        parameters: [
            { label: "$sName", documentation: "Name of the test." }
        ]
    },
    { name: "teststep", documentation: "Begins a named test step.",
        parameters: [
            { label: "$sName", documentation: "Name of the test step." }
        ]
    }
];

// Signatures for dotted method calls: $cdp.browser.launch(, $chrome.newPage(, etc.
const METHOD_SIGNATURES_LIST: FunctionSignature[] = [
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
    }
];

// AutoIt is case-insensitive, so key lookups on the lowercased name.
const METHOD_SIGNATURES = new Map<string, FunctionSignature[]>(
    METHOD_SIGNATURES_LIST.map(f => [f.name.toLowerCase(), [f]])
);

// name (lowercased) → overloads. Built from au3.api plus AUTOIT_FUNCTIONS; keywords excluded.
let functionSignatures = new Map<string, FunctionSignature[]>();
// Completion items for every known function and keyword, built once at startup.
let functionCompletionItems: CompletionItem[] = [];

function loadAu3ApiEntries(): FunctionSignature[] {
    // The compiled server runs from out/server/; au3.api lives at the extension root.
    const candidates = [
        path.join(__dirname, '..', '..', 'au3.api'),
        path.join(__dirname, 'au3.api')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return parseAu3Api(candidate);
        }
    }
    connection.console.warn(`au3.api not found, built-in function IntelliSense limited to hand-maintained entries (looked in: ${candidates.join(', ')})`);
    return [];
}

function initializeAutoItApi() {
    const byName = new Map<string, FunctionSignature[]>();
    for (const fn of loadAu3ApiEntries()) {
        const key = fn.name.toLowerCase();
        const overloads = byName.get(key);
        if (overloads) {
            overloads.push(fn);
        } else {
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
                kind: CompletionItemKind.Keyword,
                detail: `${fn.name} (keyword)`,
                documentation: fn.documentation,
                insertText: fn.name + " "
            });
            continue;
        }
        functionSignatures.set(fn.name.toLowerCase(), overloads);
        functionCompletionItems.push({
            label: fn.name,
            kind: CompletionItemKind.Function,
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

function buildSignatureLabel(fn: FunctionSignature): string {
    return fn.label ?? `${fn.name}(${fn.parameters.map(p => p.label).join(", ")})`;
}

// Make each method completion insert "name(" and pop parameter hints, matching function completions.
function withCallParens(items: CompletionItem[]): CompletionItem[] {
    return items.map(item => ({
        ...item,
        insertText: item.label + "(",
        command: {
            command: "editor.action.triggerParameterHints",
            title: "Trigger Parameter Hints"
        }
    }));
}

// Finds the call the cursor is inside by scanning backwards for the first unmatched "(".
// isMethod is true when the call is dotted (e.g. "$cdp.browser.launch("), false for a bare call ("teststep(").
function findEnclosingCall(before: string): { name: string; openParen: number; isMethod: boolean } | null {
    let depth = 0;
    for (let i = before.length - 1; i >= 0; i--) {
        const ch = before[i];
        if (ch === ')') { depth++; continue; }
        if (ch === '(') {
            if (depth > 0) { depth--; continue; }
            const head = before.slice(0, i);
            const m = /(\.?)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(head);
            if (!m) return null;
            return { name: m[2], openParen: i, isMethod: m[1] === '.' };
        }
    }
    return null;
}

// Count top-level commas (ignore commas inside nested parens or quotes)
function countTopLevelCommas(argsText: string): number {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let escape = false;
    let commas = 0;
    for (let i = 0; i < argsText.length; i++) {
        const ch = argsText[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
        if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
        if (inSingle || inDouble) continue;
        if (ch === '(') { depth++; continue; }
        if (ch === ')') { if (depth > 0) depth--; continue; }
        if (ch === ',' && depth === 0) { commas++; }
    }
    return commas;
}

connection.onSignatureHelp((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const text = doc.getText();
    const offset = doc.offsetAt(params.position);
    const before = text.slice(0, offset);

    const call = findEnclosingCall(before);
    if (!call) return null;

    const registry = call.isMethod ? METHOD_SIGNATURES : functionSignatures;
    const overloads = registry.get(call.name.toLowerCase());
    if (!overloads || overloads.length === 0) return null;

    const commas = countTopLevelCommas(text.slice(call.openParen + 1, offset));

    // Prefer the first overload with enough parameters for the argument currently being typed.
    let active = overloads.findIndex(o => o.parameters.length > commas);
    if (active === -1) active = overloads.length - 1;

    return {
        signatures: overloads.map(fn => ({
            label: buildSignatureLabel(fn),
            documentation: fn.documentation,
            parameters: fn.parameters
        })),
        activeSignature: active,
        activeParameter: Math.min(commas, Math.max(overloads[active].parameters.length - 1, 0))
    } as SignatureHelp;
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
    "_locateFast",
    "_locate",
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
    if (!doc) return [];

    const text = doc.getText();
    const offset = doc.offsetAt(params.position);
    const before = text.slice(0, offset);

    // IntelliSense for Locator object methods after .locator(...).
    if (/\.locator\([^)]*\)\.$/i.test(before)) {
        return withCallParens(LOCATOR_METHODS.map(name => ({
            label: name,
            kind: CompletionItemKind.Method
        })));
    }

    const prefix = getPrefix(text, offset);


    // IntelliSense for typing the $browser persistent global variable
    if (/^\$[A-Za-z0-9_]*$/i.test(prefix)) {
        const range = {
            start: doc.positionAt(offset - prefix.length),
            end: doc.positionAt(offset)
        };
        return [
            {
                label: "$browser",
                kind: CompletionItemKind.Variable,
                detail: "Persistent global variable",
                documentation: "Persistent browser handle",
                textEdit: TextEdit.replace(range, "$browser."),
                command: {
                    command: "editor.action.triggerSuggest",
                    title: "Trigger Suggest"
                }
            },
            {
                label: "$config",
                kind: CompletionItemKind.Variable,
                detail: "Persistent global variable",
                documentation: "Persistent config handle",
                textEdit: TextEdit.replace(range, "$config."),
                command: {
                    command: "editor.action.triggerSuggest",
                    title: "Trigger Suggest"
                }
            },
            {
                label: "$api",
                kind: CompletionItemKind.Variable,
                detail: "Persistent global variable",
                documentation: "Persistent api handle",
                textEdit: TextEdit.replace(range, "$api."),
                command: {
                    command: "editor.action.triggerSuggest",
                    title: "Trigger Suggest"
                }
            },
            {
                label: "$cdp",
                kind: CompletionItemKind.Variable,
                detail: "Persistent global variable",
                documentation: "Persistent CDP handle",
                textEdit: TextEdit.replace(range, "$cdp."),
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
                label: "state", kind: CompletionItemKind.Property, detail: "$cdp.state", documentation: "CDP runtime state (connected, sessionId, browserPid, etc.)"
            },
            {
                label: "config", kind: CompletionItemKind.Property, detail: "$cdp.config", documentation: "Configuration values for CDP UDF",
                insertText: "config.", command: { command: "editor.action.triggerSuggest", title: "Trigger Suggest" }
            },
            {
                label: "browser", kind: CompletionItemKind.Property, detail: "$cdp.browser", documentation: "Browser-level operations",
                insertText: "browser.", command: { command: "editor.action.triggerSuggest", title: "Trigger Suggest" }
            },
            {
                label: "api", kind: CompletionItemKind.Property, detail: "$cdp.api", documentation: "AutoIt wrapper for CDP commands",
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

    function isLocatorObjectCall(text: string, offset: number): boolean {
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
            } else if (ch === '(') {
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
            { label: "objectToNode", kind: CompletionItemKind.Method, detail: "Convert to node", documentation: "Returns the DOM node corresponding to this locator." },
            { label: "click", kind: CompletionItemKind.Method, detail: "Click element", documentation: "Clicks the matched element." },
            { label: "clickAt", kind: CompletionItemKind.Method, detail: "Click at", documentation: "Clicks the element at a specific location." },
            { label: "dblClick", kind: CompletionItemKind.Method, detail: "Double click", documentation: "Double-clicks the matched element." },
            { label: "hover", kind: CompletionItemKind.Method, detail: "Hover element", documentation: "Moves the mouse over the matched element." },
            { label: "tap", kind: CompletionItemKind.Method, detail: "Tap element", documentation: "Taps the matched element on touch-capable devices." },
            { label: "fill", kind: CompletionItemKind.Method, detail: "Fill input", documentation: "Fills the matched input element." },
            { label: "sendKeys", kind: CompletionItemKind.Method, detail: "Send keys", documentation: "Sends keystrokes to the matched element." },
            { label: "press", kind: CompletionItemKind.Method, detail: "Press key", documentation: "Presses a key while the element is focused." },
            { label: "check", kind: CompletionItemKind.Method, detail: "Check checkbox", documentation: "Checks the matched checkbox." },
            { label: "uncheck", kind: CompletionItemKind.Method, detail: "Uncheck checkbox", documentation: "Unchecks the matched checkbox." },
            { label: "setChecked", kind: CompletionItemKind.Method, detail: "Set checked state", documentation: "Sets the checked state of the matched checkbox." },
            { label: "selectOption", kind: CompletionItemKind.Method, detail: "Select option", documentation: "Selects an option in a select element." },
            { label: "focus", kind: CompletionItemKind.Method, detail: "Focus element", documentation: "Focuses the matched element." },
            { label: "blur", kind: CompletionItemKind.Method, detail: "Blur element", documentation: "Removes focus from the matched element." },
            { label: "clear", kind: CompletionItemKind.Method, detail: "Clear field", documentation: "Clears the value of the matched element." },
            { label: "dragTo", kind: CompletionItemKind.Method, detail: "Drag element", documentation: "Drags the element to another target." },
            { label: "setInputFiles", kind: CompletionItemKind.Method, detail: "Set input files", documentation: "Sets files for a file input element." },
            { label: "dispatchEvent", kind: CompletionItemKind.Method, detail: "Dispatch event", documentation: "Dispatches a DOM event on the element." },
            { label: "scrollIntoView", kind: CompletionItemKind.Method, detail: "Scroll into view", documentation: "Scrolls the element into view." },
            { label: "scrollIntoViewIfNeeded", kind: CompletionItemKind.Method, detail: "Scroll into view if needed", documentation: "Scrolls the element into view if it is not already visible." },
            { label: "textContent", kind: CompletionItemKind.Method, detail: "Text content", documentation: "Returns the text content of the element." },
            { label: "innerText", kind: CompletionItemKind.Method, detail: "Inner text", documentation: "Returns the inner text of the element." },
            { label: "innerTextCRStripped", kind: CompletionItemKind.Method, detail: "Inner text CR stripped", documentation: "Returns inner text with CR characters stripped." },
            { label: "innerTextLFStripped", kind: CompletionItemKind.Method, detail: "Inner text LF stripped", documentation: "Returns inner text with LF characters stripped." },
            { label: "innerTextReplace", kind: CompletionItemKind.Method, detail: "Inner text replace", documentation: "Returns inner text with replacements applied." },
            { label: "innerHTML", kind: CompletionItemKind.Method, detail: "Inner HTML", documentation: "Returns the inner HTML of the element." },
            { label: "inputValue", kind: CompletionItemKind.Method, detail: "Input value", documentation: "Returns the value of the input element." },
            { label: "getAttribute", kind: CompletionItemKind.Method, detail: "Get attribute", documentation: "Gets an attribute value from the element." },
            { label: "boundingBox", kind: CompletionItemKind.Method, detail: "Bounding box", documentation: "Returns the element's bounding box." },
            { label: "screenshot", kind: CompletionItemKind.Method, detail: "Screenshot element", documentation: "Takes a screenshot of the element." },
            { label: "evaluate", kind: CompletionItemKind.Method, detail: "Evaluate script", documentation: "Evaluates JavaScript in the page context on this locator." },
            { label: "evaluateAll", kind: CompletionItemKind.Method, detail: "Evaluate all", documentation: "Evaluates JavaScript across all matched elements." },
            { label: "elementHandle", kind: CompletionItemKind.Method, detail: "Element handle", documentation: "Returns the element handle for the matched element." },
            { label: "allInnerTexts", kind: CompletionItemKind.Method, detail: "All inner texts", documentation: "Gets inner texts of all matched elements." },
            { label: "allTextContents", kind: CompletionItemKind.Method, detail: "All text contents", documentation: "Gets text contents of all matched elements." },
            { label: "count", kind: CompletionItemKind.Method, detail: "Count elements", documentation: "Returns the number of matched elements." },
            { label: "isVisible", kind: CompletionItemKind.Method, detail: "Is visible", documentation: "Returns true if the element is visible." },
            { label: "isHidden", kind: CompletionItemKind.Method, detail: "Is hidden", documentation: "Returns true if the element is hidden." },
            { label: "isEnabled", kind: CompletionItemKind.Method, detail: "Is enabled", documentation: "Returns true if the element is enabled." },
            { label: "isDisabled", kind: CompletionItemKind.Method, detail: "Is disabled", documentation: "Returns true if the element is disabled." },
            { label: "isEditable", kind: CompletionItemKind.Method, detail: "Is editable", documentation: "Returns true if the element is editable." },
            { label: "isChecked", kind: CompletionItemKind.Method, detail: "Is checked", documentation: "Returns true if the element is checked." },
            { label: "waitFor", kind: CompletionItemKind.Method, detail: "Wait for", documentation: "Waits for the locator to satisfy the given state." },
            { label: "waitForElementState", kind: CompletionItemKind.Method, detail: "Wait for element state", documentation: "Waits for the element to reach the given state." },
            { label: "waitForSelector", kind: CompletionItemKind.Method, detail: "Wait for selector", documentation: "Waits for a selector relative to this locator." },
            { label: "_locateFast", kind: CompletionItemKind.Method, detail: "Locate fast", documentation: "Fast locator lookup." },
            { label: "_locate", kind: CompletionItemKind.Method, detail: "Locate", documentation: "Locator lookup." },
            { label: "filter", kind: CompletionItemKind.Method, detail: "Filter locator", documentation: "Filters matched elements." },
            { label: "nth", kind: CompletionItemKind.Method, detail: "Nth element", documentation: "Selects the nth matched element." },
            { label: "first", kind: CompletionItemKind.Method, detail: "First element", documentation: "Selects the first matched element." },
            { label: "last", kind: CompletionItemKind.Method, detail: "Last element", documentation: "Selects the last matched element." },
            { label: "getByRole", kind: CompletionItemKind.Method, detail: "Get by role", documentation: "Returns locator by ARIA role." },
            { label: "getByText", kind: CompletionItemKind.Method, detail: "Get by text", documentation: "Returns locator by text." },
            { label: "getByLabel", kind: CompletionItemKind.Method, detail: "Returns locator by label." },
            { label: "getByPlaceholder", kind: CompletionItemKind.Method, detail: "Returns locator by placeholder text." },
            { label: "getByAltText", kind: CompletionItemKind.Method, detail: "Returns locator by alt text." },
            { label: "getByTitle", kind: CompletionItemKind.Method, detail: "Returns locator by title." },
            { label: "getByTestId", kind: CompletionItemKind.Method, detail: "Returns locator by test id." }
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

    function isPageHandleVariableName(variableName: string): boolean {
        return /page/i.test(variableName);
    }

    function isBrowserHandleVariableName(variableName: string): boolean {
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
        detail: `${domainName}.${cmd.name} → ${toAutoItFunctionName(domainName, cmd.name)}`,
        documentation: cmd.description ?? ''
    }));

});


documents.listen(connection);
connection.listen();
