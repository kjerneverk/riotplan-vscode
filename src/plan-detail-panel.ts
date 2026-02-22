/**
 * Plan Detail Panel
 *
 * A rich webview panel for viewing a RiotPlan plan with tabs for
 * Overview (IDEA), Steps, Evidence, and History.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { HttpMcpClient } from './mcp-client';

export class PlanDetailPanel {
    public static readonly viewType = 'riotplanDetail';
    public static currentPanels = new Map<string, PlanDetailPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly planPath: string,
        private readonly mcpClient: HttpMcpClient,
        private readonly initialProject?: any
    ) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (msg) => this._handleMessage(msg),
            null,
            this._disposables
        );
        this._loadContent();
    }

    static createOrShow(
        planPath: string,
        planName: string,
        mcpClient: HttpMcpClient,
        initialProject?: any
    ): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        const existing = PlanDetailPanel.currentPanels.get(planPath);
        if (existing) {
            existing._panel.reveal(column);
            existing._panel.title = planName;
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            PlanDetailPanel.viewType,
            planName,
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        PlanDetailPanel.currentPanels.set(
            planPath,
            new PlanDetailPanel(panel, planPath, mcpClient, initialProject)
        );
    }

    private async _handleMessage(msg: any): Promise<void> {
        switch (msg.command) {
            case 'refresh':
                await this._loadContent();
                break;
            case 'saveIdeaContent':
                await this._saveIdeaContent(msg.content);
                break;
            case 'getStepContent':
                await this._sendStepContent(msg.stepNumber);
                break;
            case 'getEvidenceContent':
                await this._sendEvidenceContent(msg.filename);
                break;
            case 'saveEvidenceContent':
                await this._saveEvidenceContent(msg.filename, msg.content);
                break;
            case 'addEvidence':
                await this._addEvidence(msg.description, msg.source, msg.summary, msg.content);
                break;
        }
    }

    private async _loadContent(): Promise<void> {
        this._panel.webview.html = this._getLoadingHtml();

        try {
            const [status, context, planResource] = await Promise.all([
                this.mcpClient.getPlanStatus(this.planPath),
                this.mcpClient.readContext(this.planPath).catch(() => null),
                this.mcpClient.getPlanResource(this.planPath).catch(() => null),
            ]);

            this._panel.webview.html = this._getHtml(status, context, planResource);
        } catch (error) {
            this._panel.webview.html = this._getErrorHtml(String(error));
        }
    }

    private async _saveIdeaContent(content: string): Promise<void> {
        try {
            await this.mcpClient.setIdeaContent(this.planPath, content);
            await this._loadContent();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save idea: ${error}`);
            this._panel.webview.postMessage({ command: 'saveError', error: String(error) });
        }
    }

    private async _sendStepContent(stepNumber: number): Promise<void> {
        try {
            const planDir = vscode.Uri.file(path.join(this.planPath, 'plan'));
            const files = await vscode.workspace.fs.readDirectory(planDir);
            const prefix = String(stepNumber).padStart(2, '0');
            const stepFile = files.find(([name]) => name.startsWith(prefix + '-'));
            if (stepFile) {
                const fileUri = vscode.Uri.file(path.join(this.planPath, 'plan', stepFile[0]));
                const data = await vscode.workspace.fs.readFile(fileUri);
                const content = Buffer.from(data).toString('utf8');
                this._panel.webview.postMessage({ command: 'stepContent', stepNumber, content });
                return;
            }
            // Fallback: try MCP resource
            const content = await this.mcpClient.readResource(
                `riotplan://step/${this.planPath}?number=${stepNumber}`
            );
            this._panel.webview.postMessage({ command: 'stepContent', stepNumber, content });
        } catch (error) {
            this._panel.webview.postMessage({
                command: 'stepContent',
                stepNumber,
                content: `*Failed to load step content: ${error}*`,
            });
        }
    }

    private async _sendEvidenceContent(filename: string): Promise<void> {
        try {
            const fileUri = vscode.Uri.file(path.join(this.planPath, 'evidence', filename));
            const data = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(data).toString('utf8');
            this._panel.webview.postMessage({ command: 'evidenceContent', filename, content });
        } catch (error) {
            this._panel.webview.postMessage({
                command: 'evidenceContent',
                filename,
                content: `# ${filename}\n\n*Failed to load: ${error}*`,
            });
        }
    }

    private async _saveEvidenceContent(filename: string, content: string): Promise<void> {
        try {
            const fileUri = vscode.Uri.file(path.join(this.planPath, 'evidence', filename));
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
            await this._loadContent();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save evidence: ${error}`);
            this._panel.webview.postMessage({ command: 'saveError', error: String(error) });
        }
    }

    private async _addEvidence(
        description: string,
        source: string,
        summary: string,
        evidenceContent: string
    ): Promise<void> {
        try {
            await this.mcpClient.addEvidence(this.planPath, description, source, summary, evidenceContent);
            await this._loadContent();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add evidence: ${error}`);
            this._panel.webview.postMessage({ command: 'saveError', error: String(error) });
        }
    }

    private dispose(): void {
        PlanDetailPanel.currentPanels.delete(this.planPath);
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

    private _esc(s: string): string {
        if (typeof s !== 'string') { return ''; }
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private _getLoadingHtml(): string {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground);
         font-family: var(--vscode-font-family); display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; }
  .loading { display: flex; flex-direction: column; align-items: center; gap: 12px;
             color: var(--vscode-descriptionForeground); }
  .dot-pulse { display: flex; gap: 6px; }
  .dot-pulse span { width: 8px; height: 8px; border-radius: 50%;
                    background: var(--vscode-progressBar-background);
                    animation: pulse 1.2s infinite; }
  .dot-pulse span:nth-child(2) { animation-delay: 0.2s; }
  .dot-pulse span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes pulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
                     40% { opacity: 1; transform: scale(1); } }
</style>
</head><body>
<div class="loading">
  <div class="dot-pulse"><span></span><span></span><span></span></div>
  <span>Loading plan…</span>
</div>
</body></html>`;
    }

    private _getErrorHtml(error: string): string {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground);
         font-family: var(--vscode-font-family); padding: 24px; margin: 0; }
  .err { color: var(--vscode-errorForeground); padding: 16px;
         border: 1px solid var(--vscode-inputValidation-errorBorder);
         border-radius: 6px; font-size: 13px; }
</style>
</head><body>
<div class="err">Failed to load plan: ${this._esc(error)}</div>
</body></html>`;
    }

    private _getHtml(status: any, context: any, planResource: any): string {
        const name = this._esc(status?.name || status?.code || 'Unknown Plan');
        const code = this._esc(status?.code || '');
        const planStatus = status?.status || context?.stage || 'unknown';
        const stage = context?.stage || planStatus;
        const progress = status?.progress ?? { completed: 0, total: 0, percentage: 0 };
        const steps = (status?.steps || []) as Array<{
            number: number; title: string; status: string; startedAt?: string; completedAt?: string;
        }>;
        const lastUpdated = status?.lastUpdated
            ? new Date(status.lastUpdated).toLocaleString() : '';
        const projectPath = this._esc(planResource?.metadata?.projectPath || '');
        const project = planResource?.project || this.initialProject || null;
        const projectName = this._esc(project?.name || project?.id || '');
        const repoUrlRaw = project?.repo?.url || '';
        const repoUrl = this._esc(repoUrlRaw);

        // Context data
        const ideaContent = context?.idea?.content || '';
        const shapingContent = context?.shaping?.content || '';
        const selectedApproach = context?.shaping?.selectedApproach || '';
        const constraints = (context?.constraints || []) as string[];
        const questions = (context?.questions || []) as string[];
        const evidenceFiles = (context?.evidence?.files || []) as Array<{
            name: string; preview: string; size: number;
        }>;
        const historyEvents = (context?.history?.recentEvents || []) as Array<{
            type: string; timestamp: string; summary: string;
        }>;

        // Stage/status colors
        const stagePalette: Record<string, { bg: string; text: string }> = {
            idea:        { bg: '#1a3a5c', text: '#4fc3f7' },
            shaping:     { bg: '#3a1a5c', text: '#ce93d8' },
            built:       { bg: '#3a2a0a', text: '#ffb74d' },
            executing:   { bg: '#3a3a0a', text: '#fff176' },
            completed:   { bg: '#0a3a1a', text: '#81c784' },
            cancelled:   { bg: '#3a0a0a', text: '#e57373' },
            in_progress: { bg: '#1a3a5c', text: '#4fc3f7' },
            pending:     { bg: '#2a2a2a', text: '#9e9e9e' },
            unknown:     { bg: '#2a2a2a', text: '#9e9e9e' },
        };
        const stagePal = stagePalette[stage] ?? stagePalette['unknown'];
        const statusPal = stagePalette[planStatus] ?? stagePalette['unknown'];

        // Progress bar
        const pct = Math.min(100, Math.max(0, progress.percentage || 0));

        // Steps HTML — clickable rows with expansion
        const stepsHtml = steps.length === 0
            ? `<div class="empty-state"><span class="empty-icon">○</span><p>No steps defined for this plan</p></div>`
            : steps.map(step => {
                const isDone = step.status === 'completed';
                const isActive = step.status === 'in_progress';
                const pal = isDone ? stagePalette['completed'] : isActive ? stagePalette['executing'] : stagePalette['pending'];
                const icon = isDone ? '✓' : isActive ? '▶' : '○';
                const rawTitle = (step.title || '').replace(/^Step\s+\d+:\s*/i, '');
                const dateStr = isDone && step.completedAt
                    ? new Date(step.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    : isActive && step.startedAt
                        ? `Started ${new Date(step.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                        : '';
                return `<div class="step-row ${isDone ? 'done' : isActive ? 'active' : ''}" data-step="${step.number}" onclick="toggleStep(${step.number})">
  <div class="step-indicator" style="color:${pal.text};border-color:${pal.text}20;background:${pal.bg}">${icon}</div>
  <div class="step-body">
    <span class="step-num">${step.number}</span>
    <span class="step-title${isDone ? ' struck' : ''}">${this._esc(rawTitle)}</span>
    ${dateStr ? `<span class="step-date">${this._esc(dateStr)}</span>` : ''}
  </div>
  <span class="step-chevron" id="step-chevron-${step.number}">›</span>
</div>
<div class="step-content-area" id="step-content-${step.number}">
  <div class="step-content-loading" id="step-loading-${step.number}">
    <span class="spinner-text">Loading…</span>
  </div>
  <div class="step-content-body md-content" id="step-body-${step.number}"></div>
</div>`;
            }).join('');

        // Evidence HTML — cards with edit buttons
        const evidenceHtml = evidenceFiles.length === 0
            ? `<div class="empty-state"><span class="empty-icon">◫</span><p>No evidence files attached</p></div>`
            : evidenceFiles.map((e, idx) => `<div class="evidence-card" id="evidence-card-${idx}">
  <div class="evidence-header">
    <span class="evidence-icon">◫</span>
    <span class="evidence-name">${this._esc(e.name)}</span>
    ${e.size ? `<span class="evidence-size">${(e.size / 1024).toFixed(1)}kb</span>` : ''}
    <button class="action-btn small" onclick="startEditEvidence('${this._esc(e.name)}', ${idx})">✎ Edit</button>
  </div>
  <div id="evidence-view-${idx}">
    ${e.preview ? `<pre class="evidence-preview">${this._esc(e.preview)}</pre>` : ''}
  </div>
  <div class="evidence-edit-area" id="evidence-edit-${idx}" style="display:none">
    <div class="edit-loading" id="evidence-loading-${idx}">Loading content…</div>
    <textarea class="content-editor" id="evidence-textarea-${idx}" style="display:none;min-height:200px"></textarea>
    <div class="editor-actions" id="evidence-edit-actions-${idx}" style="display:none">
      <button class="action-btn primary" onclick="saveEvidence('${this._esc(e.name)}', ${idx})">Save</button>
      <button class="action-btn" onclick="cancelEditEvidence(${idx})">Cancel</button>
    </div>
  </div>
</div>`).join('');

        // History HTML
        const historyHtml = historyEvents.length === 0
            ? `<div class="empty-state"><span class="empty-icon">◷</span><p>No history events</p></div>`
            : historyEvents.map(e => {
                const timeStr = e.timestamp
                    ? new Date(e.timestamp).toLocaleString(undefined, {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                    }) : '';
                const typeColor = e.type?.includes('complete') ? '#81c784'
                    : e.type?.includes('start') ? '#4fc3f7'
                        : e.type?.includes('error') || e.type?.includes('fail') ? '#e57373'
                            : '#9e9e9e';
                return `<div class="history-row">
  <div class="history-dot" style="background:${typeColor}"></div>
  <div class="history-body">
    <span class="history-type" style="color:${typeColor}">${this._esc(e.type || '')}</span>
    <span class="history-summary">${this._esc(e.summary || '')}</span>
  </div>
  <span class="history-time">${this._esc(timeStr)}</span>
</div>`;
            }).join('');

        // Tab labels
        const stepTab = `Steps${steps.length > 0 ? ` (${progress.completed}/${progress.total})` : ''}`;
        const evidTab = `Evidence${evidenceFiles.length > 0 ? ` (${evidenceFiles.length})` : ''}`;
        const histTab = `History${historyEvents.length > 0 ? ` (${historyEvents.length})` : ''}`;

        // Constraints & questions for overview tab
        const constraintsBlock = constraints.length > 0
            ? `<div class="meta-section"><h3 class="meta-section-title">⚑ Constraints</h3><ul class="bullet-list">${constraints.map(c => `<li>${this._esc(c)}</li>`).join('')}</ul></div>`
            : '';
        const questionsBlock = questions.length > 0
            ? `<div class="meta-section"><h3 class="meta-section-title">? Open Questions</h3><ul class="bullet-list">${questions.map(q => `<li>${this._esc(q)}</li>`).join('')}</ul></div>`
            : '';
        const shapingBlock = shapingContent
            ? `<div class="meta-section">${selectedApproach ? `<h3 class="meta-section-title">✦ Selected Approach: ${this._esc(selectedApproach)}</h3>` : `<h3 class="meta-section-title">✦ Shaping</h3>`}<div class="shaping-content md-content" id="shaping-md"></div></div>`
            : '';

        // Embed content as JSON for the webview JS to render.
        // Escape </ to prevent </script> in content from closing the script tag early.
        const escapeScript = (s: string) => s.replace(/<\//g, '\\u003c/');
        const ideaJson = escapeScript(JSON.stringify(ideaContent));
        const shapingJson = escapeScript(JSON.stringify(shapingContent));

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
*, *::before, *::after { box-sizing: border-box; }

body {
    margin: 0;
    padding: 0;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    line-height: 1.6;
    overflow-x: hidden;
}

/* ── Header ──────────────────────────────────────────────────── */
.header {
    padding: 20px 24px 0;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}

.title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
}

.plan-title {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--vscode-editor-foreground);
    line-height: 1.3;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    flex-shrink: 0;
}

.refresh-btn {
    background: transparent;
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(255,255,255,0.15));
    color: var(--vscode-descriptionForeground);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    transition: background 0.15s;
}
.refresh-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-editor-foreground);
}

.progress-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
}

.progress-bar {
    flex: 1;
    height: 5px;
    background: var(--vscode-progressBar-background, rgba(255,255,255,0.1));
    border-radius: 3px;
    overflow: hidden;
    opacity: 0.4;
    max-width: 240px;
}
.progress-bar.has-progress { opacity: 1; }
.progress-fill {
    height: 100%;
    border-radius: 3px;
    background: var(--vscode-progressBar-background, #4fc3f7);
    transition: width 0.4s ease;
}

.progress-label {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
}

.meta-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding-bottom: 12px;
    flex-wrap: wrap;
}
.meta-item {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    display: flex;
    align-items: center;
    gap: 4px;
}
.meta-item .label {
    opacity: 0.6;
}
.meta-item .mono {
    font-family: var(--vscode-editor-font-family, monospace);
}
.meta-link {
    color: var(--vscode-textLink-foreground, #4fc3f7);
    text-decoration: none;
}
.meta-link:hover {
    text-decoration: underline;
}

/* ── Tabs ────────────────────────────────────────────────────── */
.tabs {
    display: flex;
    gap: 0;
    padding: 0 24px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
    overflow-x: auto;
}

.tab-btn {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--vscode-descriptionForeground);
    padding: 10px 16px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s;
    margin-bottom: -1px;
}
.tab-btn:hover {
    color: var(--vscode-editor-foreground);
    background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.05));
}
.tab-btn.active {
    color: var(--vscode-editor-foreground);
    border-bottom-color: var(--vscode-focusBorder, #4fc3f7);
    font-weight: 500;
}

/* ── Content pane ────────────────────────────────────────────── */
.pane {
    display: none;
    padding: 24px;
    overflow-y: auto;
    max-height: calc(100vh - 160px);
}
.pane.active { display: block; }

/* Make Idea edit mode use full available vertical space */
#idea-edit-mode {
    display: none;
    flex-direction: column;
    height: calc(100vh - 250px);
    min-height: 320px;
}
#idea-edit-mode .content-editor {
    flex: 1;
    min-height: 0;
    height: auto;
    resize: none;
}
#idea-edit-mode .editor-actions {
    position: sticky;
    bottom: 0;
    z-index: 2;
    margin-top: 0;
    padding: 10px 0 0;
    background: var(--vscode-editor-background);
    border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
}

/* ── Action buttons ──────────────────────────────────────────── */
.action-btn {
    background: transparent;
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(255,255,255,0.15));
    color: var(--vscode-descriptionForeground);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
}
.action-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-editor-foreground);
}
.action-btn.primary {
    background: var(--vscode-button-background, #0e639c);
    border-color: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #ffffff);
}
.action-btn.primary:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
}
.action-btn.small {
    padding: 2px 7px;
    font-size: 10px;
}

/* ── Section toolbar ─────────────────────────────────────────── */
.section-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    justify-content: flex-end;
}

/* ── Content editor (textarea) ───────────────────────────────── */
.content-editor {
    width: 100%;
    min-height: 300px;
    background: var(--vscode-input-background, rgba(255,255,255,0.04));
    border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.15));
    border-radius: 4px;
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    line-height: 1.6;
    padding: 10px 12px;
    resize: vertical;
    outline: none;
    display: block;
}
.content-editor:focus {
    border-color: var(--vscode-focusBorder, #4fc3f7);
}
.content-editor.small {
    min-height: 100px;
}

/* ── Editor actions row ──────────────────────────────────────── */
.editor-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
}

/* ── Markdown content ────────────────────────────────────────── */
.md-content h1 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 8px;
    color: var(--vscode-editor-foreground);
    padding-bottom: 6px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
}
.md-content h2 {
    font-size: 13px;
    font-weight: 600;
    margin: 18px 0 6px;
    color: var(--vscode-editor-foreground);
    opacity: 0.9;
}
.md-content h3 {
    font-size: 12px;
    font-weight: 600;
    margin: 14px 0 4px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.06em;
}
.md-content p {
    margin: 0 0 10px;
    color: var(--vscode-editor-foreground);
    opacity: 0.9;
    line-height: 1.65;
}
.md-content ul, .md-content ol {
    margin: 0 0 10px;
    padding-left: 20px;
}
.md-content li {
    margin-bottom: 4px;
    color: var(--vscode-editor-foreground);
    opacity: 0.9;
    line-height: 1.5;
}
.md-content code {
    background: var(--vscode-textCodeBlock-background, rgba(255,255,255,0.08));
    padding: 1px 5px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
}
.md-content blockquote {
    border-left: 3px solid var(--vscode-focusBorder, #4fc3f7);
    margin: 0 0 10px;
    padding: 4px 12px;
    opacity: 0.7;
}
.md-content strong { font-weight: 600; }
.md-content em { font-style: italic; opacity: 0.85; }
.md-content hr {
    border: none;
    border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
    margin: 16px 0;
}
.md-content a { color: var(--vscode-textLink-foreground, #4fc3f7); text-decoration: none; }
.md-content a:hover { text-decoration: underline; }

/* ── Meta sections (constraints, questions) ─────────────────── */
.meta-section {
    margin-top: 24px;
    padding: 16px;
    background: var(--vscode-sideBar-background, rgba(255,255,255,0.03));
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
    border-radius: 6px;
}
.meta-section-title {
    margin: 0 0 10px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
}
.bullet-list {
    margin: 0;
    padding-left: 16px;
    list-style: disc;
}
.bullet-list li {
    font-size: 12px;
    color: var(--vscode-editor-foreground);
    opacity: 0.85;
    margin-bottom: 5px;
    line-height: 1.5;
}
.shaping-content {
    font-size: 12px;
    opacity: 0.9;
}

/* ── Steps ───────────────────────────────────────────────────── */
.steps-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.step-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
    user-select: none;
}
.step-row:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
    border-color: var(--vscode-panel-border, rgba(255,255,255,0.08));
}
.step-row.active {
    background: rgba(79, 195, 247, 0.06);
    border-color: rgba(79, 195, 247, 0.2);
}
.step-row.expanded {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-bottom-color: transparent;
}
.step-indicator {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    border: 1px solid;
    flex-shrink: 0;
    margin-top: 1px;
}
.step-body {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
}
.step-num {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-weight: 600;
    min-width: 16px;
    flex-shrink: 0;
}
.step-title {
    font-size: 13px;
    color: var(--vscode-editor-foreground);
    flex: 1;
    min-width: 0;
}
.step-title.struck {
    text-decoration: line-through;
    opacity: 0.5;
}
.step-date {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    opacity: 0.7;
    flex-shrink: 0;
}
.step-chevron {
    font-size: 14px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.4;
    flex-shrink: 0;
    transition: transform 0.2s;
    margin-top: 1px;
}
.step-chevron.open {
    transform: rotate(90deg);
    opacity: 0.7;
}

/* Step content area */
.step-content-area {
    display: none;
    padding: 14px 16px 16px 50px;
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
    border-top: none;
    border-radius: 0 0 6px 6px;
    background: var(--vscode-sideBar-background, rgba(255,255,255,0.02));
    margin-bottom: 4px;
}
.step-content-area.visible { display: block; }
.step-content-loading {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.6;
    padding: 8px 0;
}
.step-content-body {
    font-size: 12px;
}

/* ── Evidence ─────────────────────────────────────────────────── */
.evidence-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.evidence-card {
    padding: 12px 14px;
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
    border-radius: 6px;
    background: var(--vscode-sideBar-background, rgba(255,255,255,0.02));
}
.evidence-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
}
.evidence-icon {
    color: var(--vscode-descriptionForeground);
    font-size: 13px;
    flex-shrink: 0;
}
.evidence-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--vscode-editor-foreground);
    flex: 1;
}
.evidence-size {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.6;
}
.evidence-preview {
    margin: 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-textCodeBlock-background, rgba(255,255,255,0.05));
    padding: 8px 10px;
    border-radius: 4px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.06));
}
.evidence-edit-area {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
}
.edit-loading {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.6;
    padding: 4px 0;
}

/* ── Evidence add form ───────────────────────────────────────── */
.evidence-form {
    padding: 16px;
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
    border-radius: 6px;
    background: var(--vscode-sideBar-background, rgba(255,255,255,0.02));
    margin-bottom: 14px;
}
.form-field {
    margin-bottom: 10px;
}
.form-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 4px;
}
.form-input {
    width: 100%;
    background: var(--vscode-input-background, rgba(255,255,255,0.04));
    border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.15));
    border-radius: 4px;
    color: var(--vscode-editor-foreground);
    font-family: inherit;
    font-size: 12px;
    padding: 5px 8px;
    outline: none;
}
.form-input:focus {
    border-color: var(--vscode-focusBorder, #4fc3f7);
}

/* ── History ─────────────────────────────────────────────────── */
.history-list {
    display: flex;
    flex-direction: column;
    position: relative;
}
.history-list::before {
    content: '';
    position: absolute;
    left: 7px;
    top: 12px;
    bottom: 12px;
    width: 1px;
    background: var(--vscode-panel-border, rgba(255,255,255,0.1));
}
.history-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 8px 0;
    position: relative;
}
.history-dot {
    width: 15px;
    height: 15px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 2px;
    position: relative;
    z-index: 1;
    box-shadow: 0 0 0 3px var(--vscode-editor-background);
}
.history-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.history-type {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.history-summary {
    font-size: 12px;
    color: var(--vscode-editor-foreground);
    opacity: 0.8;
    line-height: 1.4;
}
.history-time {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.6;
    white-space: nowrap;
    flex-shrink: 0;
    margin-top: 3px;
}

/* ── Empty states ────────────────────────────────────────────── */
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.5;
    text-align: center;
}
.empty-icon {
    font-size: 32px;
    margin-bottom: 10px;
    opacity: 0.4;
}
.empty-state p { margin: 0; font-size: 12px; }
</style>
</head>
<body>

<!-- ── Header ───────────────────────────────────────── -->
<div class="header">
  <div class="title-row">
    <h1 class="plan-title" title="${this._esc(status?.code || '')}">${name}</h1>
    <span class="badge" style="background:${stagePal.bg};color:${stagePal.text}">${this._esc(stage)}</span>
    ${planStatus !== stage ? `<span class="badge" style="background:${statusPal.bg};color:${statusPal.text}">${this._esc(planStatus)}</span>` : ''}
    <button class="refresh-btn" onclick="refresh()">↻ Refresh</button>
  </div>

  ${progress.total > 0 ? `
  <div class="progress-row">
    <div class="progress-bar has-progress">
      <div class="progress-fill" style="width:${pct}%"></div>
    </div>
    <span class="progress-label">${progress.completed} / ${progress.total} steps &nbsp;·&nbsp; ${Math.round(pct)}%</span>
  </div>` : ''}

  <div class="meta-row">
    ${code ? `<span class="meta-item"><span class="label">code:</span> ${code}</span>` : ''}
    ${lastUpdated ? `<span class="meta-item"><span class="label">updated:</span> ${this._esc(lastUpdated)}</span>` : ''}
    ${status?.lastCompleted ? `<span class="meta-item"><span class="label">last step:</span> ${status.lastCompleted}</span>` : ''}
    ${projectName ? `<span class="meta-item"><span class="label">project:</span> ${projectName}</span>` : ''}
    ${projectPath ? `<span class="meta-item"><span class="label">project path:</span> <span class="mono">${projectPath}</span></span>` : ''}
    ${repoUrl ? `<span class="meta-item"><span class="label">repo:</span> <a class="meta-link" href="${repoUrl}">${repoUrl}</a></span>` : ''}
  </div>
</div>

<!-- ── Tabs ──────────────────────────────────────────── -->
<div class="tabs">
  <button class="tab-btn active" data-tab="overview">Overview</button>
  <button class="tab-btn" data-tab="steps">${this._esc(stepTab)}</button>
  <button class="tab-btn" data-tab="evidence">${this._esc(evidTab)}</button>
  <button class="tab-btn" data-tab="history">${this._esc(histTab)}</button>
</div>

<!-- ── Overview tab ─────────────────────────────────── -->
<div id="pane-overview" class="pane active">
  <div class="section-toolbar">
    <button class="action-btn" id="edit-idea-btn">✎ Edit Idea</button>
  </div>
  <!-- View mode -->
  <div id="idea-view">
    ${ideaContent
        ? `<div class="md-content" id="idea-md"></div>`
        : `<div class="empty-state"><span class="empty-icon">☆</span><p>No IDEA.md found — click Edit to create one</p></div>`
}
    ${constraintsBlock}${questionsBlock}${shapingBlock}
  </div>
  <!-- Edit mode -->
  <div id="idea-edit-mode" style="display:none">
    <textarea id="idea-textarea" class="content-editor" placeholder="Write your idea in Markdown..."></textarea>
    <div class="editor-actions">
      <button class="action-btn primary" id="save-idea-btn">Save</button>
      <button class="action-btn" id="cancel-idea-btn">Cancel</button>
    </div>
  </div>
</div>

<!-- ── Steps tab ────────────────────────────────────── -->
<div id="pane-steps" class="pane">
  <div class="steps-list">${stepsHtml}</div>
</div>

<!-- ── Evidence tab ─────────────────────────────────── -->
<div id="pane-evidence" class="pane">
  <div class="section-toolbar">
    <button class="action-btn" id="add-evidence-toggle" onclick="toggleNewEvidenceForm()">+ Add Evidence</button>
  </div>
  <!-- New evidence form -->
  <div id="new-evidence-form" class="evidence-form" style="display:none">
    <div class="form-field">
      <label class="form-label">Description *</label>
      <input type="text" id="ev-description" class="form-input" placeholder="What does this evidence show?" />
    </div>
    <div class="form-field">
      <label class="form-label">Source</label>
      <input type="text" id="ev-source" class="form-input" placeholder="URL or file path..." />
    </div>
    <div class="form-field">
      <label class="form-label">Summary</label>
      <input type="text" id="ev-summary" class="form-input" placeholder="One-line summary..." />
    </div>
    <div class="form-field">
      <label class="form-label">Content</label>
      <textarea id="ev-content" class="content-editor small" placeholder="Evidence text (optional)..."></textarea>
    </div>
    <div class="editor-actions">
      <button class="action-btn primary" onclick="submitNewEvidence()">Add Evidence</button>
      <button class="action-btn" onclick="toggleNewEvidenceForm()">Cancel</button>
    </div>
  </div>
  <!-- Evidence cards -->
  <div class="evidence-list">${evidenceHtml}</div>
</div>

<!-- ── History tab ──────────────────────────────────── -->
<div id="pane-history" class="pane">
  <div class="history-list">${historyHtml}</div>
</div>

<script>
// ── Tab switching ────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
        document.querySelectorAll('.pane').forEach(function(p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var pane = document.getElementById('pane-' + tab);
        if (pane) { pane.classList.add('active'); }
    });
});

// ── VSCode API + Refresh ─────────────────────────────────────
var vscode = acquireVsCodeApi();
function refresh() { vscode.postMessage({ command: 'refresh' }); }

// ── Minimal markdown renderer ────────────────────────────────
function renderMarkdown(md) {
    if (md == null || typeof md !== 'string') { return ''; }
    var html = md;

    // Unescape HTML entities so we can re-process as markdown
    html = html
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');

    // Code blocks first (before inline code)
    html = html.replace(/\x60\x60\x60[\\w]*\\n([\\s\\S]*?)\x60\x60\x60/g, function(_, code) {
        return '<pre style="background:var(--vscode-textCodeBlock-background,rgba(255,255,255,0.06));padding:10px 12px;border-radius:5px;font-family:monospace;font-size:11px;overflow-x:auto;margin:8px 0"><code>' +
            escHtml(code.trim()) + '</code></pre>';
    });

    // Headers
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^#### (.+)$/gm, '<h3>$1</h3>');

    // Horizontal rule
    html = html.replace(/^---+$/gm, '<hr>');

    // Bold + italic
    html = html.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Inline code
    html = html.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');

    // Links
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');

    // Unordered lists
    html = html.replace(/((?:^[-*] .+$\\n?)+)/gm, function(match) {
        var items = match.trim().split('\\n')
            .map(function(line) { return line.replace(/^[-*] /, '').trim(); })
            .filter(Boolean)
            .map(function(item) { return '<li>' + item + '</li>'; }).join('');
        return '<ul>' + items + '</ul>';
    });

    // Ordered lists
    html = html.replace(/((?:^\\d+\\. .+$\\n?)+)/gm, function(match) {
        var items = match.trim().split('\\n')
            .map(function(line) { return line.replace(/^\\d+\\. /, '').trim(); })
            .filter(Boolean)
            .map(function(item) { return '<li>' + item + '</li>'; }).join('');
        return '<ol>' + items + '</ol>';
    });

    // Paragraphs
    var blockTags = /^<(h[1-6]|ul|ol|pre|hr|blockquote)/;
    html = html.split(/\\n\\n+/).map(function(block) {
        var trimmed = block.trim();
        if (!trimmed) { return ''; }
        if (blockTags.test(trimmed)) { return trimmed; }
        return '<p>' + trimmed.replace(/\\n/g, ' ') + '</p>';
    }).join('\\n');

    return html;
}

function escHtml(s) {
    if (s == null || typeof s !== 'string') { return ''; }
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Render initial markdown content ─────────────────────────
var ideaMd = ${ideaJson};
var shapingMd = ${shapingJson};
try {
    var ideaEl = document.getElementById('idea-md');
    if (ideaEl && ideaMd) { ideaEl.innerHTML = renderMarkdown(ideaMd); }
    var shapingEl = document.getElementById('shaping-md');
    if (shapingEl && shapingMd) { shapingEl.innerHTML = renderMarkdown(shapingMd); }
} catch (e) {
    console.error('Markdown render error:', e);
}

// ── Idea editing ─────────────────────────────────────────────
function startEditIdea() {
    document.getElementById('idea-view').style.display = 'none';
    document.getElementById('idea-edit-mode').style.display = 'flex';
    document.getElementById('idea-textarea').value = ideaMd || '';
    document.getElementById('idea-textarea').focus();
}

function saveIdea() {
    var content = document.getElementById('idea-textarea').value;
    vscode.postMessage({ command: 'saveIdeaContent', content: content });
}

function cancelEditIdea() {
    document.getElementById('idea-edit-mode').style.display = 'none';
    document.getElementById('idea-view').style.display = 'block';
}

// Wire up idea edit buttons (avoids inline onclick + global scope issues)
var editIdeaBtn = document.getElementById('edit-idea-btn');
if (editIdeaBtn) { editIdeaBtn.addEventListener('click', startEditIdea); }
var saveIdeaBtn = document.getElementById('save-idea-btn');
if (saveIdeaBtn) { saveIdeaBtn.addEventListener('click', saveIdea); }
var cancelIdeaBtn = document.getElementById('cancel-idea-btn');
if (cancelIdeaBtn) { cancelIdeaBtn.addEventListener('click', cancelEditIdea); }

// ── Step expansion ───────────────────────────────────────────
var stepLoaded = {};

function toggleStep(n) {
    var area = document.getElementById('step-content-' + n);
    var chevron = document.getElementById('step-chevron-' + n);
    var row = document.querySelector('[data-step="' + n + '"]');
    if (!area) { return; }

    if (area.classList.contains('visible')) {
        area.classList.remove('visible');
        if (chevron) { chevron.classList.remove('open'); }
        if (row) { row.classList.remove('expanded'); }
    } else {
        area.classList.add('visible');
        if (chevron) { chevron.classList.add('open'); }
        if (row) { row.classList.add('expanded'); }
        if (!stepLoaded[n]) {
            vscode.postMessage({ command: 'getStepContent', stepNumber: n });
        }
    }
}

// ── Evidence add form ────────────────────────────────────────
function toggleNewEvidenceForm() {
    var form = document.getElementById('new-evidence-form');
    var btn = document.getElementById('add-evidence-toggle');
    if (!form) { return; }
    if (form.style.display === 'none') {
        form.style.display = 'block';
        if (btn) { btn.textContent = '✕ Cancel'; }
        var descInput = document.getElementById('ev-description');
        if (descInput) { descInput.focus(); }
    } else {
        form.style.display = 'none';
        if (btn) { btn.textContent = '+ Add Evidence'; }
        // Clear fields
        ['ev-description','ev-source','ev-summary','ev-content'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) { el.value = ''; }
        });
    }
}

function submitNewEvidence() {
    var descEl = document.getElementById('ev-description');
    var desc = descEl ? descEl.value.trim() : '';
    if (!desc) {
        if (descEl) { descEl.focus(); descEl.style.borderColor = 'var(--vscode-inputValidation-errorBorder, #f44)'; }
        return;
    }
    var sourceEl = document.getElementById('ev-source');
    var summaryEl = document.getElementById('ev-summary');
    var contentEl = document.getElementById('ev-content');
    vscode.postMessage({
        command: 'addEvidence',
        description: desc,
        source: sourceEl ? sourceEl.value.trim() : '',
        summary: summaryEl ? summaryEl.value.trim() : '',
        content: contentEl ? contentEl.value.trim() : '',
    });
    toggleNewEvidenceForm();
}

// ── Evidence editing ─────────────────────────────────────────
// Track which card index is awaiting content per filename
var evidencePendingIdx = {};

function startEditEvidence(filename, idx) {
    var editArea = document.getElementById('evidence-edit-' + idx);
    var viewArea = document.getElementById('evidence-view-' + idx);
    if (!editArea) { return; }
    if (viewArea) { viewArea.style.display = 'none'; }
    editArea.style.display = 'block';
    var loading = document.getElementById('evidence-loading-' + idx);
    var textarea = document.getElementById('evidence-textarea-' + idx);
    var actions = document.getElementById('evidence-edit-actions-' + idx);
    if (loading) { loading.style.display = 'block'; }
    if (textarea) { textarea.style.display = 'none'; }
    if (actions) { actions.style.display = 'none'; }
    evidencePendingIdx[filename] = idx;
    vscode.postMessage({ command: 'getEvidenceContent', filename: filename });
}

function saveEvidence(filename, idx) {
    var textarea = document.getElementById('evidence-textarea-' + idx);
    if (!textarea) { return; }
    vscode.postMessage({ command: 'saveEvidenceContent', filename: filename, content: textarea.value });
}

function cancelEditEvidence(idx) {
    var editArea = document.getElementById('evidence-edit-' + idx);
    var viewArea = document.getElementById('evidence-view-' + idx);
    if (editArea) { editArea.style.display = 'none'; }
    if (viewArea) { viewArea.style.display = 'block'; }
}

// ── Messages from extension ──────────────────────────────────
window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg || !msg.command) { return; }

    if (msg.command === 'stepContent') {
        var n = msg.stepNumber;
        var loading = document.getElementById('step-loading-' + n);
        var body = document.getElementById('step-body-' + n);
        if (loading) { loading.style.display = 'none'; }
        if (body) { body.innerHTML = renderMarkdown(msg.content || ''); }
        stepLoaded[n] = true;
    }

    if (msg.command === 'evidenceContent') {
        var idx = evidencePendingIdx[msg.filename];
        if (idx === undefined) { return; }
        delete evidencePendingIdx[msg.filename];
        var loading = document.getElementById('evidence-loading-' + idx);
        var textarea = document.getElementById('evidence-textarea-' + idx);
        var actions = document.getElementById('evidence-edit-actions-' + idx);
        if (loading) { loading.style.display = 'none'; }
        if (textarea) {
            textarea.value = msg.content || '';
            textarea.style.display = 'block';
            textarea.focus();
        }
        if (actions) { actions.style.display = 'flex'; }
    }

    if (msg.command === 'saveError') {
        console.error('Save error:', msg.error);
    }
});
</script>
</body>
</html>`;
    }
}
