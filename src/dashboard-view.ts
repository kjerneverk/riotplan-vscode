/**
 * Dashboard View Provider
 *
 * A WebviewPanel that shows all RiotPlan plans in a color-coded table
 * grouped by lifecycle stage (Idea, Shaping, Built, Executing, Done).
 * Inspired by Protokoll's dashboard design.
 */

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { HttpMcpClient } from './mcp-client';

interface WebviewMessage {
    type: string;
    planRef?: string;
}

interface PlanSummary {
    ref: string;
    uuid?: string;
    id?: string;
    path: string;
    code: string;
    name: string;
    stage: string;
    status: string;
    progress?: { completed: number; total: number; percentage: number };
    lastUpdated?: string;
}

export class DashboardViewProvider {
    public static readonly viewType = 'riotplan.dashboard';

    private _panel: vscode.WebviewPanel | null = null;
    private _mcpClient: HttpMcpClient | null = null;
    private _unsubscribeNotification?: () => void;
    private _watchdogTimer?: ReturnType<typeof setInterval>;
    private _debounceTimer?: ReturnType<typeof setTimeout>;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    setClient(client: HttpMcpClient): void {
        this._unregisterHandlers();
        this._mcpClient = client;

        this._unsubscribeNotification = client.onNotification(
            'notifications/resource_changed',
            () => {
                if (this._panel?.visible) {
                    this._scheduleDebouncedRefresh();
                    this._startWatchdog();
                }
            }
        );
    }

    async show(): Promise<void> {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
        } else {
            this._panel = vscode.window.createWebviewPanel(
                DashboardViewProvider.viewType,
                'RiotPlan Dashboard',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [this._extensionUri],
                }
            );
            this._panel.iconPath = new vscode.ThemeIcon('project');

            this._panel.webview.html = this._getHtml();

            this._panel.webview.onDidReceiveMessage(
                async (message: WebviewMessage) => {
                    await this._handleWebviewMessage(message);
                },
                null
            );

            this._panel.onDidChangeViewState((e) => {
                if (e.webviewPanel.visible) {
                    this._scheduleDebouncedRefresh();
                    this._startWatchdog();
                } else {
                    this._clearWatchdog();
                }
            });

            this._panel.onDidDispose(() => {
                this._clearAllTimers();
                this._unregisterHandlers();
                this._panel = null;
            });
        }

        await this._refreshData();
        this._startWatchdog();
    }

    postMessage(message: unknown): void {
        this._panel?.webview.postMessage(message);
    }

    async refreshData(): Promise<void> {
        await this._refreshData();
    }

    private _startWatchdog(): void {
        this._clearWatchdog();
        this._watchdogTimer = setInterval(() => {
            if (this._panel?.visible) {
                void this._refreshData();
            }
        }, 120_000);
    }

    private _clearWatchdog(): void {
        if (this._watchdogTimer) {
            clearInterval(this._watchdogTimer);
            this._watchdogTimer = undefined;
        }
    }

    private _clearAllTimers(): void {
        this._clearWatchdog();
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = undefined;
        }
    }

    private _scheduleDebouncedRefresh(): void {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(async () => {
            this._debounceTimer = undefined;
            await this._refreshData();
        }, 500);
    }

    private _unregisterHandlers(): void {
        this._unsubscribeNotification?.();
        this._unsubscribeNotification = undefined;
    }

    private async _refreshData(): Promise<void> {
        if (!this._mcpClient || !this._panel) {
            return;
        }

        try {
            const plans = await this._fetchPlans();
            this.postMessage({ type: 'update-plans', data: plans });
        } catch (err) {
            console.error('RiotPlan: [DASHBOARD] Failed to refresh data:', err);
        }
    }

    private async _fetchPlans(): Promise<{
        totalCount: number;
        stages: Array<{ stage: string; plans: PlanSummary[] }>;
    }> {
        if (!this._mcpClient) {
            return { totalCount: 0, stages: [] };
        }

        try {
            const result = await this._mcpClient.listPlans('all');
            const plansData = result?.content?.[0]?.text;
            if (!plansData) {
                return { totalCount: 0, stages: [] };
            }

            const parsed = JSON.parse(plansData);
            const plans: PlanSummary[] = (parsed.plans || []).map((p: any) => ({
                ref: p.uuid || p.id || p.path || p.code || p.name || '',
                uuid: p.uuid,
                id: p.id,
                path: p.path || p.code,
                code: p.code || p.id || p.uuid || 'plan',
                name: p.name || p.code || p.id || p.uuid || 'Untitled Plan',
                stage: normalizeStage(p.stage),
                status: normalizeStatus(p.status, p.stage),
                progress: p.progress,
                lastUpdated: p.lastUpdated || p.updatedAt || p.createdAt,
            }));

            const stageOrder = ['idea', 'shaping', 'built', 'executing', 'done', 'cancelled'];
            const stageMap = new Map<string, PlanSummary[]>();

            for (const plan of plans) {
                const stage = plan.stage.toLowerCase();
                if (!stageMap.has(stage)) {
                    stageMap.set(stage, []);
                }
                stageMap.get(stage)!.push(plan);
            }

            const stages = stageOrder
                .filter((s) => stageMap.has(s))
                .map((s) => ({
                    stage: s,
                    plans: stageMap.get(s)!.sort((a, b) => {
                        const aTime = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
                        const bTime = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
                        return bTime - aTime;
                    }),
                }));

            for (const [stage, planList] of stageMap.entries()) {
                if (!stageOrder.includes(stage)) {
                    stages.push({
                        stage,
                        plans: planList.sort((a, b) => {
                            const aTime = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
                            const bTime = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
                            return bTime - aTime;
                        }),
                    });
                }
            }

            return { totalCount: plans.length, stages };
        } catch (err) {
            console.error('RiotPlan: [DASHBOARD] Failed to fetch plans:', err);
            return { totalCount: 0, stages: [] };
        }
    }

    private async _handleWebviewMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'refresh':
                await this._refreshData();
                break;

            case 'open-plan':
                if (message.planRef) {
                    await vscode.commands.executeCommand('riotplan.openPlan', message.planRef);
                }
                break;

            case 'create-plan':
                await vscode.commands.executeCommand('riotplan.createPlan');
                break;
        }
    }

    private _getHtml(): string {
        const nonce = randomUUID().replace(/-/g, '');

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 script-src 'nonce-${nonce}';
                 style-src 'unsafe-inline';">
  <title>RiotPlan Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.5;
      padding: 20px 28px;
    }

    #app { max-width: 1200px; }

    .dashboard-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35));
    }

    .dashboard-header h1 {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -.3px;
    }

    .header-actions { display: flex; gap: 8px; align-items: center; }

    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 5px 12px;
      border-radius: 3px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }

    .btn-secondary {
      background: transparent;
      color: var(--vscode-editor-foreground);
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35));
    }
    .btn-secondary:hover {
      background: var(--vscode-list-hoverBackground, rgba(128,128,128,.1));
    }

    .total-badge {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 10px;
      border-radius: 10px;
      font-size: 12px;
      margin-left: 12px;
    }

    .stage-section {
      margin-bottom: 24px;
    }

    .stage-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      padding: 8px 12px;
      border-radius: 6px;
    }

    .stage-header h2 {
      font-size: 14px;
      font-weight: 600;
      text-transform: capitalize;
      margin: 0;
    }

    .stage-count {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background: rgba(255,255,255,0.15);
    }

    .stage-idea .stage-header { background: rgba(79, 195, 247, 0.15); color: #4fc3f7; }
    .stage-shaping .stage-header { background: rgba(206, 147, 216, 0.15); color: #ce93d8; }
    .stage-built .stage-header { background: rgba(255, 183, 77, 0.15); color: #ffb74d; }
    .stage-executing .stage-header { background: rgba(255, 241, 118, 0.15); color: #fff176; }
    .stage-done .stage-header { background: rgba(129, 199, 132, 0.15); color: #81c784; }
    .stage-cancelled .stage-header { background: rgba(229, 115, 115, 0.15); color: #e57373; }

    .plans-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .plans-table th {
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-widget-border);
      color: var(--vscode-descriptionForeground);
      font-weight: 500;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .plans-table td {
      padding: 10px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    }

    .plan-row {
      cursor: pointer;
      transition: background 0.1s;
    }

    .plan-row:hover td {
      background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.1));
    }

    .plan-name {
      font-weight: 500;
      color: var(--vscode-editor-foreground);
    }

    .plan-code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .progress-bar {
      width: 100px;
      height: 6px;
      background: var(--vscode-progressBar-background, rgba(255,255,255,0.1));
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .progress-idea { background: #4fc3f7; }
    .progress-shaping { background: #ce93d8; }
    .progress-built { background: #ffb74d; }
    .progress-executing { background: #fff176; }
    .progress-done { background: #81c784; }

    .progress-text {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }

    .time {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: var(--vscode-descriptionForeground);
    }

    .empty-icon {
      font-size: 48px;
      opacity: 0.3;
      margin-bottom: 16px;
    }

    .placeholder {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 24px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="app">
    <header class="dashboard-header">
      <div style="display:flex;align-items:center">
        <h1>RiotPlan Dashboard</h1>
        <span class="total-badge" id="total-count">0 plans</span>
      </div>
      <div class="header-actions">
        <button class="btn btn-secondary" id="refresh-btn" title="Refresh data">↺ Refresh</button>
        <button class="btn" id="create-btn" title="Create a new plan">+ New Plan</button>
      </div>
    </header>

    <div id="plans-container">
      <div class="placeholder">Loading plans…</div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('refresh-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    document.getElementById('create-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'create-plan' });
    });

    const STAGE_COLORS = {
      'idea': '#4fc3f7',
      'shaping': '#ce93d8',
      'built': '#ffb74d',
      'executing': '#fff176',
      'done': '#81c784',
      'cancelled': '#e57373'
    };

    function formatTime(iso) {
      if (!iso) return '—';
      try {
        const diffMs = Date.now() - new Date(iso).getTime();
        if (isNaN(diffMs)) return iso;
        const diffMin = Math.round(diffMs / 60000);
        if (diffMin < 2) return 'just now';
        if (diffMin < 60) return diffMin + ' min ago';
        const diffHrs = Math.round(diffMin / 60);
        if (diffHrs < 24) return diffHrs + ' hr' + (diffHrs === 1 ? '' : 's') + ' ago';
        const diffDays = Math.round(diffHrs / 24);
        if (diffDays < 7) return diffDays + ' day' + (diffDays === 1 ? '' : 's') + ' ago';
        return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      } catch {
        return iso;
      }
    }

    function openPlan(planRef) {
      vscode.postMessage({ type: 'open-plan', planRef: planRef });
    }

    function renderPlans(data) {
      const container = document.getElementById('plans-container');
      const totalBadge = document.getElementById('total-count');

      if (!data || data.totalCount === 0) {
        totalBadge.textContent = '0 plans';
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">☆</div><p>No plans found</p><p style="margin-top:8px;font-size:12px">Create your first plan to get started</p></div>';
        return;
      }

      totalBadge.textContent = data.totalCount + ' plan' + (data.totalCount === 1 ? '' : 's');

      let html = '';
      const stages = Array.isArray(data.stages) ? data.stages : [];
      for (const stageGroup of stages) {
        const plans = Array.isArray(stageGroup.plans) ? stageGroup.plans : [];
        const stageClass = 'stage-' + stageGroup.stage;
        const stageColor = STAGE_COLORS[stageGroup.stage] || '#9e9e9e';

        html += '<div class="stage-section ' + stageClass + '">';
        html += '<div class="stage-header">';
        html += '<h2>' + stageGroup.stage + '</h2>';
        html += '<span class="stage-count">' + plans.length + '</span>';
        html += '</div>';

        html += '<table class="plans-table">';
        html += '<thead><tr><th>Plan</th><th>Progress</th><th>Updated</th></tr></thead>';
        html += '<tbody>';

        for (const plan of plans) {
          const planRef = plan.ref || plan.uuid || plan.id || plan.path || plan.code || plan.name || '';
          const pct = plan.progress ? plan.progress.percentage : 0;
          const progressClass = 'progress-' + stageGroup.stage;

          html += '<tr class="plan-row"';
          if (planRef) {
            html += ' data-plan-ref="' + escapeAttr(planRef) + '"';
          }
          html += '>';

          html += '<td>';
          html += '<div class="plan-name">' + escapeHtml(plan.name) + '</div>';
          html += '<div class="plan-code">' + escapeHtml(plan.code) + '</div>';
          html += '</td>';

          html += '<td>';
          if (plan.progress && plan.progress.total > 0) {
            html += '<div class="progress-bar"><div class="progress-fill ' + progressClass + '" style="width:' + pct + '%"></div></div>';
            html += '<div class="progress-text">' + plan.progress.completed + '/' + plan.progress.total + ' steps</div>';
          } else {
            html += '<span class="time">' + escapeHtml(plan.status || '—') + '</span>';
          }
          html += '</td>';

          html += '<td class="time">' + formatTime(plan.lastUpdated) + '</td>';
          html += '</tr>';
        }

        html += '</tbody></table></div>';
      }

      container.innerHTML = html;
      container.querySelectorAll('tr.plan-row[data-plan-ref]').forEach((row) => {
        row.addEventListener('click', () => {
          const planRef = row.getAttribute('data-plan-ref');
          if (planRef) {
            openPlan(planRef);
          }
        });
      });
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'update-plans') {
        renderPlans(msg.data);
      }
    });
  </script>
</body>
</html>`;
    }
}

function normalizeStage(stage: unknown): string {
    if (typeof stage !== 'string' || !stage.trim()) {
        return 'unknown';
    }
    const normalized = stage.toLowerCase();
    if (normalized === 'completed') {
        return 'done';
    }
    return normalized;
}

function normalizeStatus(status: unknown, stage: unknown): string {
    if (typeof status === 'string' && status.trim()) {
        return status;
    }
    if (typeof stage === 'string' && stage.trim()) {
        return stage;
    }
    return 'unknown';
}
