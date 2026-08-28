import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { WorkspaceEntry, WorkspaceListData, Group, createEmptyData } from './types';

const STORE_FILE = 'workspaces.json';

export class WorkspaceStore {
  private data: WorkspaceListData = createEmptyData();
  private readonly storageUri: vscode.Uri;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.storageUri = vscode.Uri.joinPath(context.globalStorageUri, STORE_FILE);
  }

  async load(): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
      const bytes = await vscode.workspace.fs.readFile(this.storageUri);
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
      if (parsed && parsed.version === 1 && Array.isArray(parsed.workspaces)) {
        this.data = { version: 2, workspaces: parsed.workspaces, groups: [] };
      } else if (parsed && parsed.version === 2 && Array.isArray(parsed.workspaces) && Array.isArray(parsed.groups)) {
        this.data = parsed;
      }
    } catch {
      this.data = createEmptyData();
    }
  }

  getAll(): WorkspaceEntry[] {
    return [...this.data.workspaces].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  get(id: string): WorkspaceEntry | undefined {
    return this.data.workspaces.find((w) => w.id === id);
  }

  findByUri(uri: string): WorkspaceEntry | undefined {
    return this.data.workspaces.find((w) => w.uri === uri);
  }

  async add(entry: Omit<WorkspaceEntry, 'id' | 'addedAt' | 'sortOrder'>): Promise<WorkspaceEntry> {
    const siblingOrders = this.data.workspaces
      .filter((w) => w.groupId === entry.groupId)
      .map((w) => w.sortOrder);
    const maxOrder = siblingOrders.reduce((m, o) => Math.max(m, o), -1);
    const full: WorkspaceEntry = {
      ...entry,
      id: randomUUID(),
      addedAt: new Date().toISOString(),
      sortOrder: maxOrder + 1,
    };
    this.data.workspaces.push(full);
    await this.persist();
    return full;
  }

  async update(id: string, patch: Partial<WorkspaceEntry>): Promise<void> {
    const idx = this.data.workspaces.findIndex((w) => w.id === id);
    if (idx === -1) return;
    this.data.workspaces[idx] = { ...this.data.workspaces[idx], ...patch, id };
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    this.data.workspaces = this.data.workspaces.filter((w) => w.id !== id);
    await this.persist();
  }

  async touchOpened(id: string): Promise<void> {
    await this.update(id, { lastOpenedAt: new Date().toISOString() });
  }

  async setGroup(id: string, groupId: string | undefined): Promise<void> {
    await this.update(id, { groupId });
  }

  getAllGroups(): Group[] {
    return [...this.data.groups].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  getGroup(id: string): Group | undefined {
    return this.data.groups.find((g) => g.id === id);
  }

  getGroupsByParent(parentId: string | undefined): Group[] {
    return this.getAllGroups().filter((g) => g.parentId === parentId);
  }

  getEntriesByGroup(groupId: string | undefined): WorkspaceEntry[] {
    return this.getAll().filter((w) => w.groupId === groupId);
  }

  async addGroup(group: Omit<Group, 'id' | 'addedAt' | 'sortOrder'>): Promise<Group> {
    const siblingOrders = this.data.groups.filter((g) => g.parentId === group.parentId).map((g) => g.sortOrder);
    const maxOrder = siblingOrders.reduce((m, o) => Math.max(m, o), -1);
    const full: Group = {
      ...group,
      id: randomUUID(),
      addedAt: new Date().toISOString(),
      sortOrder: maxOrder + 1,
    };
    this.data.groups.push(full);
    await this.persist();
    return full;
  }

  async updateGroup(id: string, patch: Partial<Group>): Promise<void> {
    const idx = this.data.groups.findIndex((g) => g.id === id);
    if (idx === -1) return;
    this.data.groups[idx] = { ...this.data.groups[idx], ...patch, id };
    await this.persist();
  }

  /** Removes the group. Child groups and entries are reparented to the removed group's parent (or root). */
  async removeGroup(id: string): Promise<void> {
    const group = this.getGroup(id);
    if (!group) return;
    for (const g of this.data.groups) {
      if (g.parentId === id) g.parentId = group.parentId;
    }
    for (const w of this.data.workspaces) {
      if (w.groupId === id) w.groupId = group.parentId;
    }
    this.data.groups = this.data.groups.filter((g) => g.id !== id);
    await this.persist();
  }

  /** True if `candidateAncestorId` is `groupId` itself or an ancestor of it (used to prevent cycles). */
  isDescendantOrSelf(groupId: string, candidateAncestorId: string): boolean {
    let current: string | undefined = groupId;
    while (current) {
      if (current === candidateAncestorId) return true;
      current = this.getGroup(current)?.parentId;
    }
    return false;
  }

  /**
   * Reorders a dragged item (group or workspace entry) to sit immediately before/after a target item
   * within the given parent level, renumbering `sortOrder` for every group + entry at that level so the
   * new order is preserved. `draggedGroupId`/`draggedEntryId` are mutually exclusive, same for the target.
   */
  async reorderWithinLevel(
    parentGroupId: string | undefined,
    dragged: { kind: 'group' | 'workspace'; id: string },
    target: { kind: 'group' | 'workspace'; id: string },
    position: 'before' | 'after'
  ): Promise<void> {
    const groups = this.getGroupsByParent(parentGroupId);
    const entries = this.getEntriesByGroup(parentGroupId);
    type Item = { kind: 'group' | 'workspace'; id: string };
    const items: Item[] = [
      ...groups.map((g) => ({ kind: 'group' as const, id: g.id })),
      ...entries.map((e) => ({ kind: 'workspace' as const, id: e.id })),
    ].sort((a, b) => this.sortOrderOf(a) - this.sortOrderOf(b));

    const withoutDragged = items.filter((it) => !(it.kind === dragged.kind && it.id === dragged.id));
    const targetIdx = withoutDragged.findIndex((it) => it.kind === target.kind && it.id === target.id);
    if (targetIdx === -1) return;
    const insertAt = position === 'before' ? targetIdx : targetIdx + 1;
    withoutDragged.splice(insertAt, 0, dragged);

    withoutDragged.forEach((it, idx) => {
      if (it.kind === 'group') {
        const g = this.getGroup(it.id);
        if (g) g.sortOrder = idx;
      } else {
        const w = this.data.workspaces.find((e) => e.id === it.id);
        if (w) w.sortOrder = idx;
      }
    });
    if (dragged.kind === 'group') {
      const g = this.getGroup(dragged.id);
      if (g) g.parentId = parentGroupId;
    } else {
      const w = this.data.workspaces.find((e) => e.id === dragged.id);
      if (w) w.groupId = parentGroupId;
    }
    await this.persist();
  }

  private sortOrderOf(item: { kind: 'group' | 'workspace'; id: string }): number {
    if (item.kind === 'group') return this.getGroup(item.id)?.sortOrder ?? 0;
    return this.data.workspaces.find((e) => e.id === item.id)?.sortOrder ?? 0;
  }

  /** Moves a dragged item (group or workspace entry) into `parentGroupId`, appended at the end of that level. */
  async appendToLevel(
    parentGroupId: string | undefined,
    dragged: { kind: 'group' | 'workspace'; id: string }
  ): Promise<void> {
    const groups = this.getGroupsByParent(parentGroupId);
    const entries = this.getEntriesByGroup(parentGroupId);
    const maxOrder = [...groups.map((g) => g.sortOrder), ...entries.map((e) => e.sortOrder)].reduce(
      (m, o) => Math.max(m, o),
      -1
    );
    if (dragged.kind === 'group') {
      const g = this.getGroup(dragged.id);
      if (!g) return;
      g.parentId = parentGroupId;
      g.sortOrder = maxOrder + 1;
    } else {
      const w = this.data.workspaces.find((e) => e.id === dragged.id);
      if (!w) return;
      w.groupId = parentGroupId;
      w.sortOrder = maxOrder + 1;
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const tmpUri = vscode.Uri.joinPath(this.context.globalStorageUri, `${STORE_FILE}.tmp`);
      const bytes = Buffer.from(JSON.stringify(this.data, null, 2), 'utf8');
      await vscode.workspace.fs.writeFile(tmpUri, bytes);
      await vscode.workspace.fs.rename(tmpUri, this.storageUri, { overwrite: true });
      this._onDidChange.fire();
    });
    return this.writeQueue;
  }
}
