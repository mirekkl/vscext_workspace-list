export interface FavouriteFile {
  path: string;
  label?: string;
}

export type WorkspaceEntryType = 'folder' | 'workspaceFile';

export interface WorkspaceEntry {
  id: string;
  uri: string;
  type: WorkspaceEntryType;
  name: string;
  description: string;
  tags: string[];
  color?: string;
  icon?: string;
  favouriteFiles: FavouriteFile[];
  sortOrder: number;
  addedAt: string;
  lastOpenedAt?: string;
  groupId?: string;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  tags: string[];
  color?: string;
  parentId?: string;
  sortOrder: number;
  addedAt: string;
}

export interface WorkspaceListData {
  version: 2;
  workspaces: WorkspaceEntry[];
  groups: Group[];
}

export function createEmptyData(): WorkspaceListData {
  return { version: 2, workspaces: [], groups: [] };
}
