import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

const REPO = 'mirekkl/vscext_workspace-list';
const EXTENSION_ID = 'kodoro.workspace-list';
const LAST_CHECK_KEY = 'workspaceList.updateLastCheck';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

interface UpdateInfo {
  version: string;
  asset: GithubAsset;
}

function parseVersion(v: string): number[] {
  return v
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv !== lv) return rv > lv;
  }
  return false;
}

async function fetchLatestRelease(): Promise<GithubRelease | undefined> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return undefined;
  return (await res.json()) as GithubRelease;
}

export async function checkForUpdate(): Promise<UpdateInfo | undefined> {
  const currentVersion = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.version as string | undefined;
  if (!currentVersion) return undefined;

  const release = await fetchLatestRelease();
  if (!release) return undefined;

  const asset = release.assets.find((a) => a.name.endsWith('.vsix'));
  if (!asset) return undefined;

  if (!isNewer(release.tag_name, currentVersion)) return undefined;

  return { version: release.tag_name.replace(/^v/, ''), asset };
}

async function downloadAndInstall(update: UpdateInfo): Promise<void> {
  const res = await fetch(update.asset.browser_download_url);
  if (!res.ok) {
    throw new Error(`Failed to download update (HTTP ${res.status}).`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-list-update-'));
  const tmpFile = path.join(tmpDir, update.asset.name);
  await fs.writeFile(tmpFile, buffer);

  await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(tmpFile));

  await fs.rm(tmpDir, { recursive: true, force: true });

  const choice = await vscode.window.showInformationMessage(
    `Workspace List updated to ${update.version}. Reload the window to finish.`,
    'Reload Window'
  );
  if (choice === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

let statusBarItem: vscode.StatusBarItem | undefined;
let pendingUpdate: UpdateInfo | undefined;

export function createUpdateStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBarItem.command = 'workspaceList.checkForUpdates';
  context.subscriptions.push(statusBarItem);
  return statusBarItem;
}

function setPendingUpdate(update: UpdateInfo | undefined): void {
  pendingUpdate = update;
  void vscode.commands.executeCommand('setContext', 'workspaceList.updateAvailable', !!update);
  if (!statusBarItem) return;
  if (update) {
    statusBarItem.text = `$(cloud-download) Workspace List ${update.version}`;
    statusBarItem.tooltip = `Workspace List ${update.version} is available. Click to update.`;
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

async function promptUpdate(update: UpdateInfo): Promise<void> {
  setPendingUpdate(update);
  const choice = await vscode.window.showInformationMessage(
    `Workspace List ${update.version} is available.`,
    'Update',
    'Later'
  );
  if (choice === 'Update') {
    await runUpdate(update);
  }
}

async function runUpdate(update: UpdateInfo): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Updating Workspace List...' },
    async () => downloadAndInstall(update)
  );
  setPendingUpdate(undefined);
}

export async function checkForUpdateCommand(): Promise<void> {
  if (pendingUpdate) {
    await runUpdate(pendingUpdate);
    return;
  }
  const update = await checkForUpdate();
  if (!update) {
    vscode.window.showInformationMessage('Workspace List is up to date.');
    return;
  }
  await promptUpdate(update);
}

export async function checkForUpdateOnStartup(context: vscode.ExtensionContext): Promise<void> {
  const lastCheck = context.globalState.get<number>(LAST_CHECK_KEY, 0);
  if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
  await context.globalState.update(LAST_CHECK_KEY, Date.now());

  try {
    const update = await checkForUpdate();
    if (update) {
      await promptUpdate(update);
    }
  } catch {
    // Silent: don't bother the user if the update check fails (offline, rate-limited, etc).
  }
}
