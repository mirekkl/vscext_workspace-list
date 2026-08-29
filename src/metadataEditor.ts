import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceStore } from './store';
import { WorkspaceEntry, Group, FavouriteFile } from './types';
import { colorPickerStyles, colorPickerScript } from './colorPicker/colorPicker';

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
  .row { display: flex; gap: 8px; align-items: center; position: relative; }
  .swatches { display: flex; flex-wrap: wrap; gap: 8px; max-width: 640px; }
  .swatch {
    width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
    border: 2px solid transparent; padding: 0; box-sizing: border-box;
  }
  .swatch:hover { border-color: var(--vscode-focusBorder); }
  .swatch.selected { border-color: var(--vscode-foreground); }
  .color-dot {
    width: 24px; height: 24px; min-width: 24px; border-radius: 50%; cursor: pointer;
    border: 1px solid var(--vscode-settings-textInputBorder, var(--vscode-input-border, transparent));
    padding: 0;
  }
  input.hex-input {
    width: 110px; max-width: 110px; flex: 0 0 auto;
    font-family: var(--vscode-editor-font-family, monospace); text-transform: lowercase;
  }
  ${colorPickerStyles()}
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
  #saveBar { padding: 18px 24px; display: flex; gap: 8px; }
  .action-btn {
    background: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
    opacity: 0.3; cursor: default; color: var(--vscode-button-foreground);
  }
  .action-btn.dirty {
    background: var(--vscode-button-background); opacity: 1; cursor: pointer;
  }
  .action-btn.dirty:hover { background: var(--vscode-button-hoverBackground); }
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
    <label class="field-label" for="colorHex"><span class="category">Workspace:</span> <span class="name">Color</span></label>
    <div class="field-description">Click a swatch to apply it, or click the dot to open the picker; double-click a color there to apply and close, or type a hex code.</div>
    <div class="swatches" id="swatches"></div>
    <div class="row" style="margin-top: 8px;">
      <button type="button" id="colorDot" class="color-dot" title="Open color picker" aria-label="Open color picker"></button>
      <input type="text" id="colorHex" class="hex-input" value="${escapeHtml(data.color || '#808080')}" spellcheck="false" />
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
    <button id="saveBtn" class="action-btn" disabled title="Save (Ctrl+Enter)">Save</button>
    <button id="revertBtn" class="action-btn" disabled title="Revert (Ctrl+Shift+Enter)">Revert</button>
  </div>

<script nonce="${nonce}">
  ${colorPickerScript()}
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
    '#d80073', '#a20025', '#647687', '#76608a', '#808080', '#000000'
  ];

  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  let colorCleared = ${JSON.stringify(!data.color)};
  let currentColorHex = ${JSON.stringify(data.color || '#808080')};
  const hexInput = document.getElementById('colorHex');
  const colorDot = document.getElementById('colorDot');
  const swatchesEl = document.getElementById('swatches');

  function renderInlineSwatches() {
    const current = colorCleared ? '' : currentColorHex.toLowerCase();
    swatchesEl.innerHTML = '';
    PRESET_COLORS.forEach((hex) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch' + (hex.toLowerCase() === current ? ' selected' : '');
      btn.style.background = hex;
      btn.title = hex;
      btn.addEventListener('click', () => applyColor(hex, false));
      swatchesEl.appendChild(btn);
    });
  }

  function applyColor(hex, cleared) {
    colorCleared = cleared;
    currentColorHex = hex;
    hexInput.value = hex;
    colorDot.style.background = hex;
    picker.setColor(hex);
    renderInlineSwatches();
  }

  const picker = createColorPicker({
    trigger: colorDot,
    initialColor: currentColorHex,
    presets: PRESET_COLORS,
    onChange: (hex) => applyColor(hex, false),
    onCommit: (hex) => applyColor(hex, false),
  });
  colorDot.style.background = colorCleared ? '#808080' : currentColorHex;
  renderInlineSwatches();

  hexInput.addEventListener('input', () => {
    const v = hexInput.value.trim();
    if (HEX_RE.test(v)) applyColor(v, false);
  });
  hexInput.addEventListener('blur', () => {
    if (!HEX_RE.test(hexInput.value.trim())) {
      applyColor(currentColorHex, colorCleared);
    }
  });

  document.getElementById('clearColorBtn').addEventListener('click', () => {
    picker.close();
    applyColor('#808080', true);
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

  function collectData() {
    const name = document.getElementById('name').value.trim();
    const description = document.getElementById('description').value;
    const tags = document.getElementById('tags').value.split(',').map(s => s.trim()).filter(Boolean);
    const color = colorCleared ? '' : currentColorHex;
    return { name, description, tags, color, favouriteFiles };
  }

  let savedData = collectData();
  let savedSnapshot = JSON.stringify(savedData);
  const saveBtn = document.getElementById('saveBtn');
  const revertBtn = document.getElementById('revertBtn');

  function setActionButtonsEnabled(enabled) {
    saveBtn.disabled = !enabled;
    saveBtn.classList.toggle('dirty', enabled);
    revertBtn.disabled = !enabled;
    revertBtn.classList.toggle('dirty', enabled);
  }

  function updateDirtyState() {
    setActionButtonsEnabled(JSON.stringify(collectData()) !== savedSnapshot);
  }

  ['name', 'description', 'tags'].forEach((id) => {
    document.getElementById(id).addEventListener('input', updateDirtyState);
  });
  const origApplyColor = applyColor;
  applyColor = function (hex, cleared) {
    origApplyColor(hex, cleared);
    updateDirtyState();
  };
  const origRenderFavs = renderFavs;
  renderFavs = function () {
    origRenderFavs();
    updateDirtyState();
  };

  saveBtn.addEventListener('click', () => {
    const data = collectData();
    vscode.postMessage({ type: 'save', data });
    savedData = { ...data, favouriteFiles: data.favouriteFiles.slice() };
    savedSnapshot = JSON.stringify(savedData);
    setActionButtonsEnabled(false);
  });

  revertBtn.addEventListener('click', () => {
    document.getElementById('name').value = savedData.name;
    document.getElementById('description').value = savedData.description;
    document.getElementById('tags').value = savedData.tags.join(', ');
    favouriteFiles = savedData.favouriteFiles.slice();
    applyColor(savedData.color || '#808080', !savedData.color);
    origRenderFavs();
    updateNameOverflow();
    setActionButtonsEnabled(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) {
      if (!revertBtn.disabled) revertBtn.click();
    } else {
      if (!saveBtn.disabled) saveBtn.click();
    }
  }, true);
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
