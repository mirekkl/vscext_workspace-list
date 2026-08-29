import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceStore } from './store';
import { WorkspaceEntry, FavouriteFile, Group } from './types';

type TreeNode = WorkspaceNode | FavouriteFileNode | GroupNode;

export class WorkspaceNode {
  readonly kind = 'workspace' as const;
  constructor(public entry: WorkspaceEntry) {}
}

export class FavouriteFileNode {
  readonly kind = 'file' as const;
  constructor(public entry: WorkspaceEntry, public file: FavouriteFile) {}
}

export class GroupNode {
  readonly kind = 'group' as const;
  constructor(public group: Group) {}
}

const DRAG_MIME = 'application/vnd.code.tree.workspacelist';

const DEFAULT_ICON_COLOR = '#c5c5c5';

function safeHex(hex: string | undefined): string {
  return hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_ICON_COLOR;
}

// Plain closed folder - used for organizational groups.
function groupIcon(hex?: string): vscode.Uri {
  const fill = safeHex(hex);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M1.5 3.5A1 1 0 0 1 2.5 2.5H6l1.5 1.5H13.5A1 1 0 0 1 14.5 5V12A1 1 0 0 1 13.5 13H2.5A1 1 0 0 1 1.5 12Z" fill="${fill}"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

// Folder with a small VS Code-ish angle-bracket mark - used for .code-workspace entries.
function workspaceFileIcon(hex?: string): vscode.Uri {
  const fill = safeHex(hex);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M1.5 3.5A1 1 0 0 1 2.5 2.5H6l1.5 1.5H13.5A1 1 0 0 1 14.5 5V12A1 1 0 0 1 13.5 13H2.5A1 1 0 0 1 1.5 12Z" fill="${fill}"/><path d="M6.6 6.2 4.9 8l1.7 1.8.8-.8L6.5 8l.9-1z" fill="#1e1e1e"/><path d="M9.4 6.2 11.1 8l-1.7 1.8-.8-.8L9.5 8l-.9-1z" fill="#1e1e1e"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

// Open folder - used for plain OS folder entries.
function osFolderIcon(hex?: string): vscode.Uri {
  const fill = safeHex(hex);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M1.5 3.5A1 1 0 0 1 2.5 2.5H6l1.5 1.5h5A1 1 0 0 1 13.5 5H4.2a1 1 0 0 0-.97.76L1.5 11.5Z" fill="${fill}" opacity="0.55"/><path d="M1.9 12.1 3.4 6.3A1 1 0 0 1 4.36 5.5h9.64a1 1 0 0 1 .97 1.24l-1.4 5.6A1 1 0 0 1 12.6 13H2.86a1 1 0 0 1-.96-1.24Z" fill="${fill}"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

function isCurrentWorkspace(entry: WorkspaceEntry): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (entry.type === 'folder' && folders && folders.length > 0) {
    return folders.some((f) => f.uri.toString() === entry.uri);
  }
  if (entry.type === 'workspaceFile' && vscode.workspace.workspaceFile) {
    return vscode.workspace.workspaceFile.toString() === entry.uri;
  }
  return false;
}

export class WorkspaceTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  readonly dropMimeTypes = [DRAG_MIME];
  readonly dragMimeTypes = [DRAG_MIME];

  private filterText = '';

  constructor(private readonly store: WorkspaceStore) {
    store.onDidChange(() => this.refresh());
    vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setFilter(text: string): void {
    this.filterText = text.trim().toLowerCase();
    this.refresh();
  }

  clearFilter(): void {
    this.setFilter('');
  }

  getFilter(): string {
    return this.filterText;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === 'workspace') {
      return this.workspaceToItem(element.entry);
    }
    if (element.kind === 'group') {
      return this.groupToItem(element.group);
    }
    return this.fileToItem(element);
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.buildLevel(undefined);
    }
    if (element.kind === 'group') {
      return this.buildLevel(element.group.id);
    }
    if (element.kind === 'workspace') {
      return element.entry.favouriteFiles.map((f) => new FavouriteFileNode(element.entry, f));
    }
    return [];
  }

  getParent(element: TreeNode): TreeNode | undefined {
    if (element.kind === 'group') {
      const parentId = element.group.parentId;
      const parent = parentId ? this.store.getGroup(parentId) : undefined;
      return parent ? new GroupNode(parent) : undefined;
    }
    if (element.kind === 'workspace') {
      const groupId = element.entry.groupId;
      const group = groupId ? this.store.getGroup(groupId) : undefined;
      return group ? new GroupNode(group) : undefined;
    }
    return new WorkspaceNode(element.entry);
  }

  private buildLevel(parentGroupId: string | undefined): TreeNode[] {
    const groups = this.store.getGroupsByParent(parentGroupId).map((g) => new GroupNode(g));
    const entries = this.store.getEntriesByGroup(parentGroupId).map((w) => new WorkspaceNode(w));

    if (!this.filterText) {
      return [...groups, ...entries];
    }

    const matchingGroups = groups.filter((g) => this.groupMatches(g.group) || this.subtreeHasMatch(g.group.id));
    const matchingEntries = entries.filter((e) => this.entryMatches(e.entry));
    return [...matchingGroups, ...matchingEntries];
  }

  private subtreeHasMatch(groupId: string): boolean {
    const childGroups = this.store.getGroupsByParent(groupId);
    const childEntries = this.store.getEntriesByGroup(groupId);
    if (childEntries.some((e) => this.entryMatches(e))) return true;
    return childGroups.some((g) => this.groupMatches(g) || this.subtreeHasMatch(g.id));
  }

  private entryMatches(entry: WorkspaceEntry): boolean {
    const haystack = [entry.name, entry.description, ...entry.tags].join(' ').toLowerCase();
    return haystack.includes(this.filterText);
  }

  private groupMatches(group: Group): boolean {
    const haystack = [group.name, group.description, ...group.tags].join(' ').toLowerCase();
    return haystack.includes(this.filterText);
  }

  private workspaceToItem(entry: WorkspaceEntry): vscode.TreeItem {
    const hasFavourites = entry.favouriteFiles.length > 0;
    const item = new vscode.TreeItem(
      entry.name,
      hasFavourites ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.id = entry.id;
    item.contextValue = 'workspaceEntry';
    item.description = entry.tags.length ? entry.tags.join(', ') : undefined;
    item.tooltip = entry.description || entry.uri;
    item.iconPath =
      entry.type === 'workspaceFile' ? workspaceFileIcon(entry.color) : osFolderIcon(entry.color);
    if (isCurrentWorkspace(entry)) {
      item.description = `${item.description ? item.description + ' · ' : ''}current`;
    }
    item.command = {
      command: 'workspaceList.entryClicked',
      title: 'Select',
      arguments: [entry],
    };
    return item;
  }

  private groupToItem(group: Group): vscode.TreeItem {
    const item = new vscode.TreeItem(group.name, vscode.TreeItemCollapsibleState.Expanded);
    item.id = `group:${group.id}`;
    item.contextValue = 'workspaceGroup';
    item.description = group.tags.length ? group.tags.join(', ') : undefined;
    item.tooltip = group.description || group.name;
    item.iconPath = groupIcon(group.color);
    return item;
  }

  private fileToItem(node: FavouriteFileNode): vscode.TreeItem {
    const label = node.file.label || path.basename(node.file.path);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'favouriteFile';
    item.iconPath = new vscode.ThemeIcon('file');
    item.tooltip = node.file.path;
    const openable = isCurrentWorkspace(node.entry);
    if (openable) {
      item.command = {
        command: 'workspaceList.openFavouriteFile',
        title: 'Open File',
        arguments: [node],
      };
    } else {
      item.description = '(open workspace to use)';
    }
    return item;
  }

  async handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): Promise<void> {
    const payload = source
      .filter((n) => n.kind !== 'file')
      .map((n) => (n.kind === 'group' ? { kind: 'group', id: n.group.id } : { kind: 'workspace', id: n.entry.id }));
    if (payload.length === 0) return;
    dataTransfer.set(DRAG_MIME, new vscode.DataTransferItem(JSON.stringify(payload)));
  }

  async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const item = dataTransfer.get(DRAG_MIME);
    if (!item) return;
    const dragged = JSON.parse(await item.asString()) as Array<{ kind: 'group' | 'workspace'; id: string }>;

    if (target === undefined) {
      for (const d of dragged) {
        await this.store.appendToLevel(undefined, d);
      }
      return;
    }

    if (target.kind === 'group') {
      // Dropping directly onto a group's own row moves the dragged item(s) INTO that group (append at end).
      const targetGroupId = target.group.id;
      for (const d of dragged) {
        if (d.kind === 'group') {
          if (d.id === targetGroupId) continue;
          if (this.store.isDescendantOrSelf(targetGroupId, d.id)) {
            vscode.window.showWarningMessage('Cannot move a group into its own subgroup.');
            continue;
          }
        }
        await this.store.appendToLevel(targetGroupId, d);
      }
      return;
    }

    // Dropping onto a workspace entry (a leaf, can't contain children): reorder next to it within its parent group.
    const parentGroupId = target.entry.groupId;
    for (const d of dragged) {
      if (d.kind === 'workspace' && d.id === target.entry.id) continue;
      if (d.kind === 'group' && parentGroupId && this.store.isDescendantOrSelf(parentGroupId, d.id)) {
        vscode.window.showWarningMessage('Cannot move a group into its own subgroup.');
        continue;
      }
      await this.store.reorderWithinLevel(
        parentGroupId,
        d,
        { kind: 'workspace', id: target.entry.id },
        'after'
      );
    }
  }
}
