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
  body {
    font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    padding: 0; font-size: 13px;
  }
  .field {
    padding: 18px 24px; border-bottom: 1px solid var(--vscode-settings-sashBorder, transparent);
  }
  .field:nth-child(odd) { background: var(--vscode-settings-rowHoverBackground, transparent); }
  .field-label {
    display: block; margin-bottom: 4px; font-size: 14px;
  }
  .field-label .category { color: var(--vscode-settings-headerForeground, var(--vscode-descriptionForeground)); font-weight: 400; }
  .field-label .name { font-weight: 600; }
  .field-description {
    color: var(--vscode-descriptionForeground); font-size: 13px; margin-bottom: 10px; line-height: 1.5; max-width: 640px;
  }
  input[type=text], textarea {
    width: 100%; max-width: 640px; box-sizing: border-box;
    background: var(--vscode-settings-textInputBackground, var(--vscode-input-background));
    color: var(--vscode-settings-textInputForeground, var(--vscode-input-foreground));
    border: 1px solid var(--vscode-settings-textInputBorder, var(--vscode-input-border, transparent));
    border-radius: 2px; padding: 7px 9px; font-family: inherit; font-size: 13px;
  }
  input[type=text]:focus, textarea:focus {
    outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
  }
  textarea {
    min-height: 100px; resize: vertical; line-height: 1.5;
  }
  .name-wrap { position: relative; max-width: 640px; }
  #name { overflow-x: auto; white-space: nowrap; text-overflow: clip; max-width: none; }
  .overflow-arrow {
    position: absolute; top: 0; right: 0; bottom: 0; width: 22px;
    display: none; align-items: center; justify-content: center;
    pointer-events: none; background: linear-gradient(to right, transparent, var(--vscode-settings-textInputBackground, var(--vscode-input-background)) 60%);
  }
  .overflow-arrow.visible { display: flex; }
  .overflow-arrow svg { width: 8px; height: 8px; fill: var(--vscode-descriptionForeground); }
  .row { display: flex; gap: 8px; align-items: center; }
  .swatches { display: flex; flex-wrap: wrap; gap: 8px; }
  .swatch {
    width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
    border: 2px solid transparent; padding: 0; box-sizing: border-box;
  }
  .swatch:hover { border-color: var(--vscode-focusBorder); }
  .swatch.selected { border-color: var(--vscode-foreground); }
  ul#favList { list-style: none; padding: 0; margin: 6px 0; max-width: 640px; }
  ul#favList li {
    display: flex; justify-content: space-between; align-items: center; padding: 6px 9px;
    background: var(--vscode-editorWidget-background); border-radius: 2px; margin-bottom: 4px;
  }
  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 6px 14px; cursor: pointer; border-radius: 2px; font-size: 13px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .remove-btn { background: transparent; color: var(--vscode-errorForeground); padding: 2px 8px; }
  .remove-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
  #saveBar { padding: 18px 24px; }
</style>
</head>
<body>
  <div class="field">
    <label class="field-label" for="name"><span class="category">Workspace:</span> <span class="name">Name</span></label>
    <div class="field-description">Up to 50 characters. Longer names scroll horizontally within the field.</div>
    <div class="name-wrap">
      <input type="text" id="name" maxlength="50" value="${escapeHtml(data.name)}" />
      <div class="overflow-arrow" id="nameOverflow"><svg viewBox="0 0 8 8"><path d="M0 0 L8 4 L0 8 Z"/></svg></div>
    </div>
  </div>

  <div class="field">
    <label class="field-label" for="description"><span class="category">Workspace:</span> <span class="name">Description</span></label>
    <textarea id="description">${escapeHtml(data.description)}</textarea>
  </div>

  <div class="field">
    <label class="field-label" for="tags"><span class="category">Workspace:</span> <span class="name">Tags</span></label>
    <div class="field-description">Comma-separated.</div>
    <input type="text" id="tags" value="${escapeHtml(data.tags.join(', '))}" />
  </div>

  <div class="field">
    <label class="field-label" for="color"><span class="category">Workspace:</span> <span class="name">Color</span></label>
    <div class="field-description">Click a swatch to apply it, or pick a custom color.</div>
    <div class="swatches" id="swatches"></div>
    <div class="row" style="margin-top: 8px;">
      <input type="color" id="color" value="${escapeHtml(data.color || '#808080')}" title="Custom color" />
      <button type="button" id="clearColorBtn" class="secondary">Clear</button>
    </div>
  </div>

  ${showFavourites ? `
  <div class="field">
    <label class="field-label"><span class="category">Workspace:</span> <span class="name">Favourite Files</span></label>
    <ul id="favList"></ul>
    <button id="addFavBtn" class="secondary">Add File...</button>
  </div>
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

  const nameInput = document.getElementById('name');
  const nameOverflow = document.getElementById('nameOverflow');
  function updateNameOverflow() {
    const atEnd = nameInput.scrollLeft + nameInput.clientWidth >= nameInput.scrollWidth - 1;
    nameOverflow.classList.toggle('visible', nameInput.scrollWidth > nameInput.clientWidth + 1 && !atEnd);
  }
  nameInput.addEventListener('input', updateNameOverflow);
  nameInput.addEventListener('scroll', updateNameOverflow);
  window.addEventListener('resize', updateNameOverflow);
  updateNameOverflow();

  const PRESET_COLORS = [
    '#e51400', '#fa6800', '#f0a30a', '#6a8f00', '#00a300',
    '#00aba9', '#1ba1e2', '#0050ef', '#6a00ff', '#aa00ff',
    '#d80073', '#a20025', '#647687', '#76608a', '#808080'
  ];

  let colorCleared = ${JSON.stringify(!data.color)};
  const colorInput = document.getElementById('color');
  const swatchesEl = document.getElementById('swatches');

  function renderSwatches() {
    swatchesEl.innerHTML = '';
    const current = colorCleared ? '' : colorInput.value.toLowerCase();
    PRESET_COLORS.forEach((hex) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch' + (hex === current ? ' selected' : '');
      btn.style.background = hex;
      btn.title = hex;
      btn.addEventListener('click', () => {
        colorCleared = false;
        colorInput.value = hex;
        renderSwatches();
      });
      swatchesEl.appendChild(btn);
    });
  }
  renderSwatches();

  colorInput.addEventListener('input', () => { colorCleared = false; renderSwatches(); });
  document.getElementById('clearColorBtn').addEventListener('click', () => {
    colorCleared = true;
    colorInput.value = '#808080';
    renderSwatches();
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
