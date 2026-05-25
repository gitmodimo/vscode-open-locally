import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";

type Mapping = {
  remote: string;
  local: string;
};

type MappingsConfiguration = Mapping[] | Record<string, string>;

type Action = "open" | "openWith" | "reveal" | "copy";

type ResolvedPath = {
  localPath: string;
  mapping?: Mapping;
  fallback: boolean;
};

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
    vscode.commands.registerCommand("openLocally.openWith", async (uri?: vscode.Uri) => {
      await handle(uri, "openWith");
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
  const resolved = resolveLocalPath(uri, remotePath);

  log(`Remote path used for mapping: ${remotePath}`);
  logResolvedPath(resolved);

  if (!resolved) {
    await showVerboseError(
      "Open Locally: no mapping matched.",
      buildContext({ action, sourceUri: uri, remotePath })
    );
    return;
  }

  const mapped = resolved.localPath;

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
    } else if (action === "openWith") {
      await openLocallyWith(mapped);
    } else {
      await revealLocally(uri, mapped);
    }
    log(`Command finished: ${action}`);
  } catch (error) {
    log(`Command failed: ${formatError(error)}`);
    await showVerboseError(
      "Open Locally failed.",
      buildContext({
        action,
        sourceUri: uri,
        remotePath,
        resolved,
        attemptedPath: mapped,
        attemptedUri: localUri,
        error
      })
    );
  }
}

async function openLocallyWith(localPath: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Open Locally With is only supported on Windows.");
  }

  log(`Calling Windows Open With picker: ${localPath}`);
  await execFileAsync("rundll32.exe", ["shell32.dll,OpenAs_RunDLL", localPath]);
}

async function execFileAsync(file: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
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

function resolveLocalPath(uri: vscode.Uri, remotePath: string): ResolvedPath | undefined {
  const mapped = mapRemoteToLocal(remotePath);

  if (mapped) {
    return mapped;
  }

  if (uri.scheme === "file") {
    log("No mapping matched; using selected local file path.");
    return {
      localPath: uri.fsPath,
      fallback: true
    };
  }

  return undefined;
}

async function sourceIsDirectory(uri: vscode.Uri): Promise<boolean | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return Boolean(stat.type & vscode.FileType.Directory);
  } catch {
    return undefined;
  }
}

function mapRemoteToLocal(remotePathRaw: string): ResolvedPath | undefined {
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
      return {
        localPath: path.normalize(localPrefix + suffix),
        mapping,
        fallback: false
      };
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

function logResolvedPath(resolved: ResolvedPath | undefined): void {
  if (!resolved) {
    log("Mapped local path: <no match>");
    return;
  }

  log(`Mapped local path: ${resolved.localPath}`);
  log(`Mapping mode: ${resolved.fallback ? "unmapped local file fallback" : "configured mapping"}`);

  if (resolved.mapping) {
    log(`Matched mapping remote: ${resolved.mapping.remote}`);
    log(`Matched mapping local: ${resolved.mapping.local}`);
  }
}

function buildContext(input: {
  action: Action;
  sourceUri: vscode.Uri;
  remotePath: string;
  resolved?: ResolvedPath;
  attemptedPath?: string;
  attemptedUri?: vscode.Uri;
  error?: unknown;
}): string {
  const lines = [
    `Action: ${input.action}`,
    `Source URI: ${input.sourceUri.toString()}`,
    `Source scheme: ${input.sourceUri.scheme}`,
    `Source path: ${input.sourceUri.path}`,
    `Source fsPath: ${input.sourceUri.fsPath}`,
    `Remote path used for mapping: ${input.remotePath}`
  ];

  if (input.resolved) {
    lines.push(`Mapped local path: ${input.resolved.localPath}`);
    lines.push(`Mapping mode: ${input.resolved.fallback ? "unmapped local file fallback" : "configured mapping"}`);

    if (input.resolved.mapping) {
      lines.push(`Matched mapping remote: ${input.resolved.mapping.remote}`);
      lines.push(`Matched mapping local: ${input.resolved.mapping.local}`);
    }
  } else {
    lines.push("Mapped local path: <no match>");
  }

  if (input.attemptedPath) {
    lines.push(`Attempted path: ${input.attemptedPath}`);
  }

  if (input.attemptedUri) {
    lines.push(`Attempted URI: ${input.attemptedUri.toString()}`);
  }

  if (input.error) {
    lines.push(`Error: ${formatError(input.error)}`);
  }

  return lines.join("\n");
}

async function showVerboseError(summary: string, details: string): Promise<void> {
  log(summary);
  for (const line of details.split("\n")) {
    log(line);
  }

  const choice = await vscode.window.showErrorMessage(summary, "Show Details");

  if (choice === "Show Details") {
    output.show();
  }
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
