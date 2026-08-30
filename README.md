# Workspace List

A VS Code extension that maintains a curated list of workspaces (folders / `.code-workspace` files) with user-editable metadata — description, tags, color, favourite files — shown in a dedicated activity bar view.

## Features

- Add folders or `.code-workspace` files to a persistent list, or import from VS Code's Recently Opened.
- Organize entries into nested groups via drag-and-drop.
- Attach a description, tags, a color, and favourite files to each entry.
- Distinct icons for groups, `.code-workspace` entries, and plain folder entries. Groups and folders are tinted with each entry's color; groups also switch between an open/closed folder icon as you expand/collapse them.
- Single-click selects an entry (and follows it in an open metadata editor); double-click opens it in a new window.
- Add a favourite file straight from the tree (inline star icon or context menu), not just from the metadata editor.
- Filter the list by name, description, or tag.
- Opens workspaces in a new window (never replaces the current one).
- Newly added entries are revealed and selected automatically.

See [SPEC.md](SPEC.md) for the full design spec.

## Installation

This extension is distributed as a `.vsix` file via [GitHub Releases](https://github.com/mirekkl/vscext_workspace-list/releases) rather than the VS Code Marketplace.

1. Download the latest `workspace-list-*.vsix` from [Releases](https://github.com/mirekkl/vscext_workspace-list/releases).
2. In VS Code: Extensions view → `...` menu → **Install from VSIX...** → select the downloaded file.

   Or from a terminal:

   ```
   code --install-extension workspace-list-X.Y.Z.vsix
   ```

## Updating

Since this isn't published to the Marketplace, VS Code won't update it automatically on its own. The extension checks GitHub Releases itself instead:

- On startup (at most once every 24 hours) it silently checks for a newer release. If one is found, a status bar item appears (`Workspace List X.Y.Z`) and a notification offers to update.
- You can check manually any time via the Command Palette: **Workspace List: Check for Updates...**, or from the view's `...` overflow menu.
- Clicking **Update** (or the status bar item) downloads the new `.vsix` and installs it in place; you'll be prompted to reload the window afterward.

## Development

- `npm run compile` — type-check only (`tsc --noEmit`), no output emitted.
- `npm run watch` — esbuild in watch mode for iterative development.
- `npm run build` / `npm run package` — production bundle via esbuild to `dist/extension.js`.
- Press `F5` in VS Code to launch an Extension Development Host.
- `npx vsce package` to build a `.vsix` for manual installation — bump `version` in `package.json` first.

No test suite or linter is currently configured.
