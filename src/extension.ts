import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

type Mapping = {
  remote: string;
  local: string;
};

type MappingsConfiguration = Mapping[] | Record<string, string>;

type Action = "open" | "reveal" | "copy";

const output = vscode.window.createOutputChannel("Open Locally");

export function activate(context: vscode.ExtensionContext) {
  log("Extension activated.");
  log(`Extension mode: ${context.extensionMode}`);
  log(`Extension kind: ${context.extension?.extensionKind ?? "<unknown>"}`);
  log(`VS Code remote name: ${vscode.env.remoteName ?? "<none>"}`);
  log(`VS Code UI kind: ${vscode.env.uiKind}`);

  context.subscriptions.push(
    vscode.commands.registerCommand("openLocally.open", async (uri?: vscode.Uri) => {
      await handle(uri, "open");
    }),
    vscode.commands.registerCommand("openLocally.reveal", async (uri?: vscode.Uri) => {
      await handle(uri, "reveal");
    }),
    vscode.commands.registerCommand("openLocally.copyPath", async (uri?: vscode.Uri) => {
      await handle(uri, "copy");
    }),
    vscode.commands.registerCommand("openLocally.showLog", () => {
      output.show();
    })
  );
}

async function handle(uri: vscode.Uri | undefined, action: Action): Promise<void> {
  log(`Command started: ${action}`);

  if (!uri) {
    log("No URI argument was provided.");
    vscode.window.showErrorMessage("Open Locally: no file or folder selected.");
    return;
  }

  log(`Source URI: ${uri.toString()}`);
  log(`Source scheme: ${uri.scheme}`);
  log(`Source path: ${uri.path}`);
  log(`Source fsPath: ${uri.fsPath}`);

  const remotePath = getRemotePath(uri);
  const mapped = mapRemoteToLocal(remotePath) ?? getUnmappedLocalPath(uri);

  log(`Remote path used for mapping: ${remotePath}`);
  log(`Mapped local path: ${mapped ?? "<no match>"}`);

  if (!mapped) {
    vscode.window.showErrorMessage(`Open Locally: no mapping matched ${remotePath}`);
    return;
  }

  if (action === "copy") {
    await vscode.env.clipboard.writeText(mapped);
    if (showInfoMessages()) {
      vscode.window.showInformationMessage(`Copied local path: ${mapped}`);
    }
    return;
  }

  const localUri = vscode.Uri.file(mapped);
  log(`Local file URI: ${localUri.toString()}`);

  try {
    if (action === "open") {
      log("Calling vscode.env.openExternal.");
      await vscode.env.openExternal(localUri);
    } else {
      await revealLocally(uri, mapped);
    }
    log(`Command finished: ${action}`);
  } catch (error) {
    log(`Command failed: ${formatError(error)}`);
    vscode.window.showErrorMessage(`Open Locally failed: ${String(error)}`);
  }
}

async function revealLocally(sourceUri: vscode.Uri, localPath: string): Promise<void> {
  const localExists = fs.existsSync(localPath);
  const localStat = localExists ? fs.statSync(localPath) : undefined;
  const isDirectory = localStat?.isDirectory() ?? await sourceIsDirectory(sourceUri) ?? false;
  const directoryPath = isDirectory ? localPath : path.dirname(localPath);
  const directoryUri = vscode.Uri.file(directoryPath);

  log(`Local path exists: ${localExists}`);
  log(`Local path is file: ${localStat?.isFile() ?? "<unknown>"}`);
  log(`Local path is directory: ${localStat?.isDirectory() ?? "<unknown>"}`);
  log(`Reveal opens directory path: ${directoryPath}`);
  log(`Reveal directory URI: ${directoryUri.toString()}`);

  log("Calling vscode.env.openExternal for reveal directory.");
  await vscode.env.openExternal(directoryUri);
}

async function sourceIsDirectory(uri: vscode.Uri): Promise<boolean | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return Boolean(stat.type & vscode.FileType.Directory);
  } catch {
    return undefined;
  }
}

function mapRemoteToLocal(remotePathRaw: string): string | undefined {
  const configurationValue = vscode.workspace
    .getConfiguration("openLocally")
    .get<MappingsConfiguration>("mappings", {});
  const mappings = readMappings(configurationValue);

  if (mappings.length === 0) {
    return undefined;
  }

  const remotePath = trimTrailingSlash(normalizeSlashes(remotePathRaw));

  const sorted = [...mappings]
    .filter(isValidMapping)
    .sort((a, b) => normalizedPrefixLength(b.remote) - normalizedPrefixLength(a.remote));

  for (const mapping of sorted) {
    const remotePrefix = trimTrailingSlash(normalizeSlashes(mapping.remote));
    const localPrefix = trimTrailingSlash(normalizeSlashes(mapping.local));

    if (remotePath === remotePrefix || remotePath.startsWith(remotePrefix + "/")) {
      const suffix = remotePath.slice(remotePrefix.length);
      return path.normalize(localPrefix + suffix);
    }
  }

  return undefined;
}

function readMappings(value: MappingsConfiguration): Mapping[] {
  if (Array.isArray(value)) {
    return value.filter(isValidMapping);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).map(([remote, local]) => ({ remote, local }));
}

function getRemotePath(uri: vscode.Uri): string {
  if (uri.scheme === "file") {
    return uri.fsPath;
  }

  return uri.path;
}

function getUnmappedLocalPath(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== "file") {
    return undefined;
  }

  log("No mapping matched; using selected local file path.");
  return uri.fsPath;
}

function isValidMapping(value: unknown): value is Mapping {
  if (!value || typeof value !== "object") {
    return false;
  }

  const mapping = value as Partial<Mapping>;
  return typeof mapping.remote === "string" &&
    mapping.remote.trim().length > 0 &&
    typeof mapping.local === "string" &&
    mapping.local.trim().length > 0;
}

function normalizedPrefixLength(value: string): number {
  return trimTrailingSlash(normalizeSlashes(value)).length;
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function showInfoMessages(): boolean {
  return vscode.workspace
    .getConfiguration("openLocally")
    .get<boolean>("showInfoMessages", true);
}

function log(message: string): void {
  output.appendLine(`[${new Date().toISOString()}] ${message}`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

export function deactivate() {}
