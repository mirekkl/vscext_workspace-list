# Workspace List — VS Code Extension Spec

## Overview
A VS Code extension that maintains a curated list of workspaces (folders / `.code-workspace` files) with user-editable metadata, accessible from a dedicated activity bar icon. Lets the user quickly browse, annotate, and launch workspaces, plus pin favourite files per workspace.

## Storage

- Data lives in a JSON file inside the extension's **global storage** directory (`context.globalStorageUri`), e.g. `workspaces.json`.
  - Not synced via VS Code Settings Sync by default; isolated per machine.
  - Not part of `settings.json`.
- Suggested schema:

```json
{
  "version": 2,
  "workspaces": [
    {
      "id": "uuid",
      "path": "file:///C:/Users/mirek/projects/foo",
      "type": "folder | workspaceFile",
      "name": "Foo Project",
      "description": "Short free-text description",
      "tags": ["work", "client-x"],
      "color": "#ff8800",
      "icon": "codicon-id-optional",
      "favouriteFiles": [
        { "path": "relative/or/absolute/path", "label": "optional display name" }
      ],
      "sortOrder": 0,
      "groupId": "uuid-of-parent-group-or-omitted-for-root",
      "addedAt": "2026-08-24T00:00:00.000Z",
      "lastOpenedAt": "2026-08-24T00:00:00.000Z"
    }
  ],
  "groups": [
    {
      "id": "uuid",
      "name": "Client A",
      "description": "",
      "tags": [],
      "color": "#4477ff",
      "parentId": "uuid-of-parent-group-or-omitted-for-root",
      "sortOrder": 0,
      "addedAt": "2026-08-24T00:00:00.000Z"
    }
  ]
}
```

- `version: 1` files (no `groups` array) are migrated in place on load: `groups` defaults to `[]`, all existing workspaces stay ungrouped.
- `sortOrder` is scoped per parent level (per `groupId`/`parentId`, not global) and kept dense (0, 1, 2, …) across the mixed set of sibling groups + entries at that level, so reordering means renumbering just that level.
- Writes are debounced and atomic (write to temp file, rename) to avoid corruption.

## Activity Bar & Sidebar View

- New activity bar icon (codicon-based) contributed via `viewsContainers`.
- Clicking it reveals a view in the **primary side bar**, positioned below Explorer (i.e. contributed as its own view container in the activity bar, not nested inside Explorer — VS Code doesn't allow injecting into the built-in Explorer container, so this will be a sibling icon whose panel appears in the primary side bar like Explorer/Search do).
- View implemented as a native `TreeView` (`TreeDataProvider`), tree structure:
  - Root: a mix of group nodes and ungrouped workspace entries, sorted by `sortOrder` (with fallback to name).
  - Group nodes are purely organizational — arbitrary nesting depth, own metadata (name/description/tags/color) editable via the same webview editor as workspace entries, but clicking/expanding a group never opens a window or switches workspace. Rendered with a folder icon (colored per the group's chosen color, if any).
  - Assign entries/subgroups to a group, or reorder them, by dragging in the tree: dropping onto a group moves the dragged item into it (appended at the end); dropping onto a workspace entry reorders the dragged item to sit right after it, within that entry's parent group (VS Code's drag-and-drop API gives no "insert before" position). A "Move to Group..." quick-pick command on workspace entries is a non-drag fallback for reparenting (not reordering).
  - Workspace entry nodes show color/icon, name, and truncated description as tooltip.
  - Expandable per-entry node: children are favourite files (only meaningful/actionable when that workspace is the currently open one — see below).
- Built-in filter box at the top of the view (VS Code tree view search/filter, or a custom `InputBox`-driven filter if native filtering proves insufficient) — filters by name, description, and tags as-you-type.
- Context menu / inline icons per entry:
  - Edit metadata (opens webview editor)
  - Remove from list
  - Open in new window (also default double-click action)
- Toolbar actions on the view:
  - Add workspace (folder/file picker)
  - Add current workspace (enabled only when a workspace is open and not already listed)
  - Refresh / sync from recently opened

## Adding Workspaces

Three ways to add an entry:
1. **Manual add** — command opens a native folder/file picker (folder or `.code-workspace` file), creates entry with default name derived from path.
2. **Add current workspace** — command (also a toolbar button) that adds the currently open workspace if not already present.
3. **Auto-track recently opened** — a command/sync action that reads VS Code's recently opened list (`vscode.workspace` recent entries API / `workbench.recentlyOpened` state where accessible) and offers to import any not already in the list (via multi-select QuickPick), rather than silently auto-adding everything.

Duplicate detection by normalized path.

## Opening Workspaces

- Double-click (or "Open in new window" context action) always opens the workspace in a **new VS Code window**, via `vscode.openFolder` with `forceNewWindow: true` (or the workspace-file equivalent).
- Updates `lastOpenedAt` on open.

## Favourite Files

- Stored as metadata (path + optional label) per workspace entry.
- Added/managed **only through the metadata editor webview** — a file picker within the editor UI lets the user browse and add favourite files for that workspace, even if it isn't currently open (browsing starts rooted at the workspace's path).
- In the tree view, favourite files appear as child nodes under their workspace entry.
- Clicking/opening a favourite file node is **only actionable when that workspace is the currently open one** in the active VS Code window — in that case it opens the file directly in the editor. When the workspace isn't open, the node is shown but disabled/non-interactive (or opens the workspace first, TBD at implementation time — default to disabled with a tooltip explaining why).

## Metadata Editor (Webview)

- Opened via context menu "Edit metadata" or a pencil icon on the tree entry.
- A `WebviewPanel` (or `WebviewView` if better suited) presenting a form:
  - Name
  - Description (multi-line text)
  - Tags (chip/tag input)
  - Color picker + optional icon picker
  - Favourite files list with add (file picker) / remove / reorder
- Save writes back to the JSON store and refreshes the tree.
- Standard webview security: strict CSP, no remote content, messages passed via `postMessage` to the extension host which performs all file I/O.

## Metadata Fields Summary

| Field | Source | Notes |
|---|---|---|
| name | manual / derived from path | editable |
| description | manual | free text |
| tags | manual | array of strings |
| color / icon | manual, hex color via `<input type="color">` picker | entries render as a colored dot + type icon; groups render as a colored folder icon |
| favouriteFiles | manual, via editor | array of {path, label} |
| sortOrder | manual, drag-to-reorder in tree (drop onto a sibling entry to move next to it; drop onto a group to move into it) | integer, dense per parent level |
| groupId (entries) / parentId (groups) | manual, via drag-and-drop or "Move to Group..." | omitted = tree root |
| addedAt | auto | set on creation |
| lastOpenedAt | auto | updated on open |

## Tech Stack

- TypeScript, bundled with esbuild, scaffolded in the style of the current official `yo code` generator output.
- `package.json` contributes: `viewsContainers`, `views`, `commands`, `menus` (context + toolbar), `configuration` (if any settings needed later).
- No external runtime dependencies beyond `vscode` API; use built-in `crypto.randomUUID()` for ids.

## Open Items / Future Considerations (not in initial scope)
- Cross-machine sync of the workspace list (currently explicitly out of scope — global storage only).
- Workspace health checks (e.g. flagging entries whose path no longer exists).
- Import/export of the list as JSON for backup/sharing.
