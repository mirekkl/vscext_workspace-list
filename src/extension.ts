import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceStore } from './store';
import { WorkspaceTreeProvider, WorkspaceNode, FavouriteFileNode, GroupNode } from './treeProvider';
import {
  openMetadataEditor,
  openGroupMetadataEditor,
  isEntryMetadataEditorOpen,
  switchOrOpenMetadataEditor,
  refreshEntryPanelIfShowing,
} from './metadataEditor';
import { WorkspaceEntry, WorkspaceEntryType, Group, FavouriteFile } from './types';
import { checkForUpdateCommand, checkForUpdateOnStartup, createUpdateStatusBarItem } from './update';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new WorkspaceStore(context);
  await store.load();
  context.subscriptions.push(store.watchForExternalChanges());

  const treeProvider = new WorkspaceTreeProvider(store);
  const treeView = vscode.window.createTreeView('workspaceList.view', {
    treeDataProvider: treeProvider,
    dragAndDropController: treeProvider,
  });
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    treeView.onDidExpandElement((e) => {
      if (e.element instanceof GroupNode) {
        treeProvider.setGroupCollapsed(e.element.group.id, false);
      }
    }),
    treeView.onDidCollapseElement((e) => {
      if (e.element instanceof GroupNode) {
        treeProvider.setGroupCollapsed(e.element.group.id, true);
      }
    })
  );

  const DOUBLE_CLICK_MS = 500;
  let lastClickedId: string | undefined;
  let lastClickedAt = 0;
  context.subscriptions.push(
    vscode.commands.registerCommand('workspaceList.entryClicked', (entry: WorkspaceEntry) => {
      const now = Date.now();
      const isDoubleClick = lastClickedId === entry.id && now - lastClickedAt < DOUBLE_CLICK_MS;
      lastClickedId = entry.id;
      lastClickedAt = now;
      if (isDoubleClick) {
        lastClickedId = undefined;
        void vscode.commands.executeCommand('workspaceList.openWorkspace', entry);
      } else if (isEntryMetadataEditorOpen()) {
        void switchOrOpenMetadataEditor(context, store, entry.id);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('workspaceList.refresh', async () => {
      await store.load();
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('workspaceList.filter', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Filter workspaces by name, description, or tag',
        value: treeProvider.getFilter(),
      });
      if (value !== undefined) {
        treeProvider.setFilter(value);
      }
    }),

    vscode.commands.registerCommand('workspaceList.clearFilter', () => treeProvider.clearFilter()),

    vscode.commands.registerCommand('workspaceList.addWorkspace', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: false,
        canSelectFiles: true,
        canSelectMany: false,
        openLabel: 'Add to Workspace List',
        filters: { 'Workspace / Folder': ['code-workspace'] },
      });
      if (!picked || !picked[0]) return;
      const uri = picked[0];
      const stat = await vscode.workspace.fs.stat(uri);
      const isFolder = (stat.type & vscode.FileType.Directory) !== 0;
      await addEntryAndReveal(store, treeView, uri, isFolder ? 'folder' : 'workspaceFile');
    }),

    vscode.commands.registerCommand('workspaceList.addCurrentWorkspace', async () => {
      const wsFile = vscode.workspace.workspaceFile;
      const folders = vscode.workspace.workspaceFolders;
      if (wsFile) {
        await addEntryAndReveal(store, treeView, wsFile, 'workspaceFile');
      } else if (folders && folders.length > 0) {
        await addEntryAndReveal(store, treeView, folders[0].uri, 'folder');
      } else {
        vscode.window.showWarningMessage('No workspace is currently open.');
      }
    }),

    vscode.commands.registerCommand('workspaceList.importRecent', async () => {
      await importFromRecentlyOpened(store, treeView);
    }),

    vscode.commands.registerCommand('workspaceList.openWorkspace', async (arg: WorkspaceEntry | WorkspaceNode) => {
      const entry = arg instanceof WorkspaceNode ? arg.entry : arg;
      const uri = vscode.Uri.parse(entry.uri);
      await store.touchOpened(entry.id);
      await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    }),

    vscode.commands.registerCommand('workspaceList.editMetadata', (node: WorkspaceNode) => {
      const id = node instanceof WorkspaceNode ? node.entry.id : (node as unknown as { entry: WorkspaceEntry }).entry.id;
      openMetadataEditor(context, store, id);
    }),

    vscode.commands.registerCommand('workspaceList.removeWorkspace', async (node: WorkspaceNode) => {
      const entry = node.entry;
      const confirm = await vscode.window.showWarningMessage(
        `Remove "${entry.name}" from the workspace list?`,
        { modal: true },
        'Remove'
      );
      if (confirm === 'Remove') {
        await store.remove(entry.id);
      }
    }),

    vscode.commands.registerCommand('workspaceList.addFavouriteFile', async (node: WorkspaceNode) => {
      const entry = node instanceof WorkspaceNode ? node.entry : (node as unknown as { entry: WorkspaceEntry }).entry;
      const base = entry.type === 'folder' ? vscode.Uri.parse(entry.uri) : undefined;
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        defaultUri: base,
        openLabel: 'Add as favourite',
      });
      if (!picked || !picked[0]) return;
      const fav: FavouriteFile = {
        path: picked[0].fsPath,
        label: path.basename(picked[0].fsPath),
      };
      const current = store.get(entry.id);
      if (!current) return;
      await store.update(entry.id, { favouriteFiles: [...current.favouriteFiles, fav] });
      refreshEntryPanelIfShowing(store, entry.id);
    }),

    vscode.commands.registerCommand('workspaceList.openFavouriteFile', async (node: FavouriteFileNode) => {
      const uri = vscode.Uri.file(node.file.path);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand('workspaceList.addGroup', async (node?: GroupNode) => {
      const name = await vscode.window.showInputBox({
        prompt: 'Group name',
        value: 'New Group',
        valueSelection: [0, 'New Group'.length],
      });
      if (!name) return;
      const parentId = node instanceof GroupNode ? node.group.id : undefined;
      await store.addGroup({ name, description: '', tags: [], parentId });
    }),

    vscode.commands.registerCommand('workspaceList.editGroupMetadata', (node: GroupNode) => {
      openGroupMetadataEditor(context, store, node.group.id);
    }),

    vscode.commands.registerCommand('workspaceList.removeGroup', async (node: GroupNode) => {
      const group = node.group;
      const confirm = await vscode.window.showWarningMessage(
        `Remove group "${group.name}"? Its contents will move up one level.`,
        { modal: true },
        'Remove'
      );
      if (confirm === 'Remove') {
        await store.removeGroup(group.id);
      }
    }),

    vscode.commands.registerCommand('workspaceList.moveToGroup', async (node: WorkspaceNode) => {
      const entry = node.entry;
      const groups = store.getAllGroups();
      const items: (vscode.QuickPickItem & { groupId: string | undefined })[] = [
        { label: '(No group / root)', groupId: undefined },
        ...groups.map((g) => ({ label: g.name, description: groupPathLabel(store, g), groupId: g.id })),
      ];
      const pick = await vscode.window.showQuickPick(items, { placeHolder: `Move "${entry.name}" to group...` });
      if (!pick) return;
      await store.setGroup(entry.id, pick.groupId);
    }),

    vscode.commands.registerCommand('workspaceList.checkForUpdates', () => checkForUpdateCommand())
  );

  createUpdateStatusBarItem(context);
  void checkForUpdateOnStartup(context);
}

function groupPathLabel(store: WorkspaceStore, group: Group): string {
  const parts: string[] = [];
  let current: Group | undefined = group;
  while (current?.parentId) {
    current = store.getGroup(current.parentId);
    if (current) parts.unshift(current.name);
  }
  return parts.join(' / ');
}

async function addEntry(
  store: WorkspaceStore,
  uri: vscode.Uri,
  type: WorkspaceEntryType
): Promise<WorkspaceEntry | undefined> {
  const uriStr = uri.toString();
  if (store.findByUri(uriStr)) {
    vscode.window.showInformationMessage('This workspace is already in the list.');
    return undefined;
  }
  const name = type === 'workspaceFile' ? path.basename(uri.fsPath, '.code-workspace') : path.basename(uri.fsPath);
  const entry = await store.add({
    uri: uriStr,
    type,
    name,
    description: '',
    tags: [],
    favouriteFiles: [],
  });
  vscode.window.showInformationMessage(`Added "${name}" to Workspace List.`);
  return entry;
}

async function addEntryAndReveal(
  store: WorkspaceStore,
  treeView: vscode.TreeView<WorkspaceNode | FavouriteFileNode | GroupNode>,
  uri: vscode.Uri,
  type: WorkspaceEntryType
): Promise<void> {
  const entry = await addEntry(store, uri, type);
  if (!entry) return;
  await treeView.reveal(new WorkspaceNode(entry), { select: true, focus: true });
}

async function importFromRecentlyOpened(
  store: WorkspaceStore,
  treeView: vscode.TreeView<WorkspaceNode | FavouriteFileNode | GroupNode>
): Promise<void> {
  const recent = await (vscode.workspace as unknown as {
    getConfiguration?: unknown;
  });
  // vscode doesn't expose recently opened via a stable API; fall back to a manual picker.
  void recent;
  const items: vscode.QuickPickItem[] = [];
  const recentlyOpened = (await vscode.commands.executeCommand('_workbench.getRecentlyOpened')) as
    | { workspaces?: Array<{ folderUri?: vscode.Uri; workspace?: { configPath: vscode.Uri }; label?: string }> }
    | undefined;

  if (!recentlyOpened || !recentlyOpened.workspaces) {
    vscode.window.showWarningMessage('Could not read recently opened workspaces from VS Code.');
    return;
  }

  const candidates: { uri: vscode.Uri; type: WorkspaceEntryType; label: string }[] = [];
  for (const entry of recentlyOpened.workspaces) {
    if (entry.folderUri) {
      const uriStr = entry.folderUri.toString();
      if (!store.findByUri(uriStr)) {
        candidates.push({ uri: entry.folderUri, type: 'folder', label: entry.label || entry.folderUri.fsPath });
      }
    } else if (entry.workspace?.configPath) {
      const uriStr = entry.workspace.configPath.toString();
      if (!store.findByUri(uriStr)) {
        candidates.push({
          uri: entry.workspace.configPath,
          type: 'workspaceFile',
          label: entry.label || entry.workspace.configPath.fsPath,
        });
      }
    }
  }

  if (candidates.length === 0) {
    vscode.window.showInformationMessage('No new recently opened workspaces to import.');
    return;
  }

  for (const c of candidates) {
    items.push({ label: c.label, description: c.uri.fsPath });
  }

  const picks = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select workspaces to import',
  });
  if (!picks || picks.length === 0) return;

  let lastAdded: WorkspaceEntry | undefined;
  for (const pick of picks) {
    const candidate = candidates.find((c) => c.label === pick.label && c.uri.fsPath === pick.description);
    if (candidate) {
      const entry = await addEntry(store, candidate.uri, candidate.type);
      if (entry) lastAdded = entry;
    }
  }
  if (lastAdded) {
    await treeView.reveal(new WorkspaceNode(lastAdded), { select: true, focus: true });
  }
}

export function deactivate(): void {}
