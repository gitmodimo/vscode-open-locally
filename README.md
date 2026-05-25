# Open Locally

Open Locally adds Explorer right-click commands for VS Code Remote SSH / Dev Containers / WSL workflows where a remote path is also available through a local or network-mounted path.

## Features

Right-click a file or folder in VS Code Explorer and choose:

- **Open Locally** - opens the mapped local path with the OS default app.
- **Reveal Locally** - reveals the mapped local path in the OS file manager.
- **Copy Local Path** - copies the mapped local path to the clipboard.

## Settings

Open VS Code Settings and search for `Open Locally`, then edit **Open Locally: Mappings**.

Each mapping row has:

- key: a remote, WSL, SSH, or Dev Container path prefix.
- value: the matching local host path prefix.

The longest matching `remote` prefix is used.

## Example

Remote/container path:

```text
/workspaces/myproject/out/report.html
```

Local/network-mounted path:

```text
Z:/myproject/out/report.html
```

Settings:

```json
{
  "openLocally.mappings": {
    "/workspaces/myproject": "Z:/myproject"
  }
}
```

## Notes

This extension does not implement global VS Code path substitution. It only applies mappings when one of its commands is used.

## Development

```bash
npm install
npm run compile
```

Press `F5` in VS Code to run an Extension Development Host.

## Package

```bash
npm install
npm run package
```

Then install the generated `.vsix` file.
