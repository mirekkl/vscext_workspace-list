import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceStore } from './store';
import { WorkspaceEntry, Group, FavouriteFile } from './types';

const panels = new Map<string, vscode.WebviewPanel>();

export function openMetadataEditor(context: vscode.ExtensionContext, store: WorkspaceStore, entryId: string): void {
  const key = `entry:${entryId}`;
  const existing = panels.get(key);
  if (existing) {
    existing.reveal();
    return;
  }

  const entry = store.get(entryId);
  if (!entry) {
    vscode.window.showErrorMessage('Workspace entry not found.');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'workspaceList.editMetadata',
    `Edit: ${entry.name}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panels.set(key, panel);
  panel.onDidDispose(() => panels.delete(key));

  panel.webview.html = renderHtml(panel.webview, {
    name: entry.name,
    description: entry.description,
    tags: entry.tags,
    color: entry.color || '',
    favouriteFiles: entry.favouriteFiles,
  });

  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case 'save': {
        await store.update(entryId, {
          name: msg.data.name,
          description: msg.data.description,
          tags: msg.data.tags,
          color: msg.data.color || undefined,
          favouriteFiles: msg.data.favouriteFiles,
        });
        panel.title = `Edit: ${msg.data.name}`;
        vscode.window.showInformationMessage(`Saved "${msg.data.name}".`);
        break;
      }
      case 'pickFavouriteFile': {
        const base = entry.type === 'folder' ? vscode.Uri.parse(entry.uri) : undefined;
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          defaultUri: base,
          openLabel: 'Add as favourite',
        });
        if (picked && picked[0]) {
          const fav: FavouriteFile = {
            path: picked[0].fsPath,
            label: path.basename(picked[0].fsPath),
          };
          panel.webview.postMessage({ type: 'favouriteAdded', file: fav });
        }
        break;
      }
    }
  });
}

export function openGroupMetadataEditor(context: vscode.ExtensionContext, store: WorkspaceStore, groupId: string): void {
  const key = `group:${groupId}`;
  const existing = panels.get(key);
  if (existing) {
    existing.reveal();
    return;
  }

  const group = store.getGroup(groupId);
  if (!group) {
    vscode.window.showErrorMessage('Group not found.');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'workspaceList.editGroupMetadata',
    `Edit Group: ${group.name}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panels.set(key, panel);
  panel.onDidDispose(() => panels.delete(key));

  panel.webview.html = renderHtml(panel.webview, {
    name: group.name,
    description: group.description,
    tags: group.tags,
    color: group.color || '',
    favouriteFiles: undefined,
  });

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'save') {
      await store.updateGroup(groupId, {
        name: msg.data.name,
        description: msg.data.description,
        tags: msg.data.tags,
        color: msg.data.color || undefined,
      });
      panel.title = `Edit Group: ${msg.data.name}`;
      vscode.window.showInformationMessage(`Saved "${msg.data.name}".`);
    }
  });
}

interface EditorData {
  name: string;
  description: string;
  tags: string[];
  color: string;
  favouriteFiles: FavouriteFile[] | undefined;
}

function renderHtml(webview: vscode.Webview, data: EditorData): string {
  const nonce = String(Date.now());
  const showFavourites = data.favouriteFiles !== undefined;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
  label { display: block; margin-top: 12px; margin-bottom: 4px; font-weight: 600; }
  input[type=text], textarea {
    width: 100%; box-sizing: border-box; background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent);
    padding: 6px; font-family: inherit;
  }
  textarea { min-height: 70px; resize: vertical; }
  .row { display: flex; gap: 8px; align-items: center; }
  ul#favList { list-style: none; padding: 0; margin: 6px 0; }
  ul#favList li { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; background: var(--vscode-editorWidget-background); margin-bottom: 4px; }
  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 6px 12px; cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .remove-btn { background: transparent; color: var(--vscode-errorForeground); padding: 2px 8px; }
  #saveBar { margin-top: 20px; }
</style>
</head>
<body>
  <label for="name">Name</label>
  <input type="text" id="name" value="${escapeHtml(data.name)}" />

  <label for="description">Description</label>
  <textarea id="description">${escapeHtml(data.description)}</textarea>

  <label for="tags">Tags (comma-separated)</label>
  <input type="text" id="tags" value="${escapeHtml(data.tags.join(', '))}" />

  <label for="color">Color</label>
  <div class="row">
    <input type="color" id="color" value="${escapeHtml(data.color || '#808080')}" />
    <button type="button" id="clearColorBtn" class="secondary">Clear</button>
  </div>

  ${showFavourites ? `
  <label>Favourite Files</label>
  <ul id="favList"></ul>
  <button id="addFavBtn" class="secondary">Add File...</button>
  ` : ''}

  <div id="saveBar">
    <button id="saveBtn">Save</button>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let favouriteFiles = ${JSON.stringify(data.favouriteFiles || [])};
  const showFavourites = ${JSON.stringify(showFavourites)};

  function renderFavs() {
    if (!showFavourites) return;
    const list = document.getElementById('favList');
    list.innerHTML = '';
    favouriteFiles.forEach((f, i) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = f.label || f.path;
      span.title = f.path;
      const btn = document.createElement('button');
      btn.textContent = 'Remove';
      btn.className = 'remove-btn';
      btn.onclick = () => { favouriteFiles.splice(i, 1); renderFavs(); };
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    });
  }
  renderFavs();

  let colorCleared = ${JSON.stringify(!data.color)};
  const colorInput = document.getElementById('color');
  colorInput.addEventListener('input', () => { colorCleared = false; });
  document.getElementById('clearColorBtn').addEventListener('click', () => {
    colorCleared = true;
    colorInput.value = '#808080';
  });

  if (showFavourites) {
    document.getElementById('addFavBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'pickFavouriteFile' });
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'favouriteAdded') {
      favouriteFiles.push(msg.file);
      renderFavs();
    }
  });

  document.getElementById('saveBtn').addEventListener('click', () => {
    const name = document.getElementById('name').value.trim();
    const description = document.getElementById('description').value;
    const tags = document.getElementById('tags').value.split(',').map(s => s.trim()).filter(Boolean);
    const color = colorCleared ? '' : colorInput.value;
    vscode.postMessage({ type: 'save', data: { name, description, tags, color, favouriteFiles } });
  });
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
