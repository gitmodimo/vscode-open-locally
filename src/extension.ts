import * as vscode from "vscode";
import * as path from "path";

type Mapping = {
  remote: string;
  local: string;
};

type Action = "open" | "reveal" | "copy";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("openLocally.open", async (uri?: vscode.Uri) => {
      await handle(uri, "open");
    }),
    vscode.commands.registerCommand("openLocally.reveal", async (uri?: vscode.Uri) => {
      await handle(uri, "reveal");
    }),
    vscode.commands.registerCommand("openLocally.copyPath", async (uri?: vscode.Uri) => {
      await handle(uri, "copy");
    })
  );
}

async function handle(uri: vscode.Uri | undefined, action: Action): Promise<void> {
  if (!uri) {
    vscode.window.showErrorMessage("Open Locally: no file or folder selected.");
    return;
  }

  const mapped = mapRemoteToLocal(uri.fsPath);

  if (!mapped) {
    vscode.window.showErrorMessage(`Open Locally: no mapping matched ${uri.fsPath}`);
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

  try {
    if (action === "open") {
      await vscode.env.openExternal(localUri);
    } else {
      await vscode.commands.executeCommand("revealFileInOS", localUri);
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Open Locally failed: ${String(error)}`);
  }
}

function mapRemoteToLocal(remotePathRaw: string): string | undefined {
  const mappings = vscode.workspace
    .getConfiguration("openLocally")
    .get<Mapping[]>("mappings", []);

  if (!Array.isArray(mappings) || mappings.length === 0) {
    return undefined;
  }

  const remotePath = normalizeSlashes(remotePathRaw);

  const sorted = [...mappings]
    .filter((m) => m.remote && m.local)
    .sort((a, b) => b.remote.length - a.remote.length);

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

export function deactivate() {}
