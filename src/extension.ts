import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceStore } from './store';
import { WorkspaceTreeProvider, WorkspaceNode, FavouriteFileNode, GroupNode } from './treeProvider';
import { openMetadataEditor, openGroupMetadataEditor } from './metadataEditor';
import { WorkspaceEntry, WorkspaceEntryType, Group } from './types';
import { checkForUpdateCommand, checkForUpdateOnStartup, createUpdateStatusBarItem } from './update';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new WorkspaceStore(context);
  await store.load();

  const treeProvider = new WorkspaceTreeProvider(store);
  const treeView = vscode.window.createTreeView('workspaceList.view', {
    treeDataProvider: treeProvider,
    dragAndDropController: treeProvider,
  });
  context.subscriptions.push(treeView);

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
        canSelectFolders: true,
        canSelectFiles: true,
        canSelectMany: false,
        openLabel: 'Add to Workspace List',
        filters: { 'Workspace Files': ['code-workspace'] },
      });
      if (!picked || !picked[0]) return;
      const uri = picked[0];
      const isWorkspaceFile = uri.fsPath.endsWith('.code-workspace');
      await addEntry(store, uri, isWorkspaceFile ? 'workspaceFile' : 'folder');
    }),

    vscode.commands.registerCommand('workspaceList.addCurrentWorkspace', async () => {
      const wsFile = vscode.workspace.workspaceFile;
      const folders = vscode.workspace.workspaceFolders;
      if (wsFile) {
        await addEntry(store, wsFile, 'workspaceFile');
      } else if (folders && folders.length > 0) {
        await addEntry(store, folders[0].uri, 'folder');
      } else {
        vscode.window.showWarningMessage('No workspace is currently open.');
      }
    }),

    vscode.commands.registerCommand('workspaceList.importRecent', async () => {
      await importFromRecentlyOpened(store);
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

async function addEntry(store: WorkspaceStore, uri: vscode.Uri, type: WorkspaceEntryType): Promise<void> {
  const uriStr = uri.toString();
  if (store.findByUri(uriStr)) {
    vscode.window.showInformationMessage('This workspace is already in the list.');
    return;
  }
  const name = type === 'workspaceFile' ? path.basename(uri.fsPath, '.code-workspace') : path.basename(uri.fsPath);
  await store.add({
    uri: uriStr,
    type,
    name,
    description: '',
    tags: [],
    favouriteFiles: [],
  });
  vscode.window.showInformationMessage(`Added "${name}" to Workspace List.`);
}

async function importFromRecentlyOpened(store: WorkspaceStore): Promise<void> {
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

  for (const pick of picks) {
    const candidate = candidates.find((c) => c.label === pick.label && c.uri.fsPath === pick.description);
    if (candidate) {
      await addEntry(store, candidate.uri, candidate.type);
    }
  }
}

export function deactivate(): void {}
