import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
    const executeCommand = vi.fn(async () => undefined);
    const createWebviewPanel = vi.fn(() => {
        let onMessage: ((message: any) => unknown) | undefined;
        let onDispose: (() => void) | undefined;
        return {
            title: '',
            reveal: vi.fn(),
            webview: {
                html: '',
                postMessage: vi.fn(),
                onDidReceiveMessage: (handler: (message: any) => unknown) => {
                    onMessage = handler;
                    return { dispose: () => {} };
                },
                __emitMessage: async (message: any) => {
                    if (onMessage) {
                        await onMessage(message);
                    }
                },
            },
            onDidDispose: (handler: () => void) => {
                onDispose = handler;
                return { dispose: () => {} };
            },
            __dispose: () => {
                onDispose?.();
            },
        };
    });

    return {
        ViewColumn: {
            One: 1,
            Beside: 2,
        },
        window: {
            activeTextEditor: undefined,
            createWebviewPanel,
        },
        commands: {
            executeCommand,
        },
    };
});

import * as vscode from 'vscode';
import { ProjectDetailPanel } from '../src/project-detail-panel';

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

async function waitForRender(check: () => void): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            check();
            return;
        } catch (error) {
            lastError = error;
            await flush();
        }
    }
    throw lastError;
}

describe('ProjectDetailPanel class', () => {
    afterEach(() => {
        (ProjectDetailPanel as any).panels?.clear?.();
        vi.clearAllMocks();
    });

    it('creates panel, renders related plans, and handles open-plan messages', async () => {
        const client = {
            getContextProject: vi.fn(async () => ({
                id: 'project-1',
                name: 'Project One',
                active: true,
            })),
            listPlans: vi.fn(async () => ({
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            plans: [
                                {
                                    id: 'plan-1',
                                    name: 'Alpha',
                                    stage: 'executing',
                                    project: { id: 'project-1' },
                                },
                                {
                                    id: 'plan-2',
                                    name: 'Other',
                                    stage: 'idea',
                                    project: { id: 'other-project' },
                                },
                            ],
                        }),
                    },
                ],
            })),
        };

        ProjectDetailPanel.createOrShow('project-1', client as any, { name: 'Initial Name' } as any);
        await flush();

        const panel = (vscode.window.createWebviewPanel as any).mock.results[0].value;
        await waitForRender(() => {
            expect(panel.title).toContain('Project One');
            expect(panel.webview.html).toContain('Related Plans (1)');
            expect(panel.webview.html).toContain('Alpha');
        });

        await panel.webview.__emitMessage({ type: 'open-plan', planRef: 'active/alpha' });
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('riotplan.openPlan', 'active/alpha');
    });

    it('reuses existing panel and refreshes on demand', async () => {
        const client = {
            getContextProject: vi.fn(async () => ({ id: 'project-2', name: 'Project Two' })),
            listPlans: vi.fn(async () => ({
                content: [{ type: 'text', text: JSON.stringify({ plans: [] }) }],
            })),
        };

        ProjectDetailPanel.createOrShow('project-2', client as any);
        await flush();
        ProjectDetailPanel.createOrShow('project-2', client as any);
        await flush();

        expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
        const panel = (vscode.window.createWebviewPanel as any).mock.results[0].value;
        expect(panel.reveal).toHaveBeenCalled();

        await panel.webview.__emitMessage({ type: 'refresh' });
        await flush();
        expect(client.getContextProject).toHaveBeenCalled();
        panel.__dispose();
    });

    it('renders error html when project loading fails', async () => {
        const client = {
            getContextProject: vi.fn(async () => {
                throw new Error('boom');
            }),
            listPlans: vi.fn(async () => ({
                content: [{ type: 'text', text: JSON.stringify({ plans: [] }) }],
            })),
        };

        ProjectDetailPanel.createOrShow('project-err', client as any);
        await flush();

        const panel = (vscode.window.createWebviewPanel as any).mock.results[0].value;
        expect(panel.webview.html).toContain('Failed to load project: boom');
    });

    it('covers html and helper branches through private methods', async () => {
        const client = {
            getContextProject: vi.fn(async () => null),
            listPlans: vi.fn(async () => ({ content: [] })),
        };

        ProjectDetailPanel.createOrShow('project-helpers', client as any, undefined);
        await flush();
        const panelInstance = (ProjectDetailPanel as any).panels.get('project-helpers');
        expect(panelInstance).toBeDefined();

        const loadProject = await (panelInstance as any).loadProject();
        expect(loadProject.id).toBe('project-helpers');

        const loadRelatedPlansNoText = await (panelInstance as any).loadRelatedPlans({ id: 'project-helpers' });
        expect(loadRelatedPlansNoText).toEqual([]);

        client.listPlans.mockResolvedValueOnce({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        plans: [
                            { id: 'b-id', project: { id: 'project-helpers' } },
                            { id: 'a-id', name: 'Alpha', project: { id: 'project-helpers' } },
                            { id: 'x-id', project: { id: 'other' } },
                        ],
                    }),
                },
            ],
        });
        const loadRelatedPlansSorted = await (panelInstance as any).loadRelatedPlans({ id: 'project-helpers' });
        expect(loadRelatedPlansSorted).toHaveLength(2);
        expect(loadRelatedPlansSorted[0].name || loadRelatedPlansSorted[0].id).toBe('Alpha');
        expect(loadRelatedPlansSorted[1].id).toBe('b-id');

        const htmlWithRepoAndTable = (panelInstance as any).getHtml(
            { id: 'project-helpers', name: 'Helpers', active: false, repo: { url: 'https://example.com/repo' } },
            [{ id: 'plan-1', name: 'One', stage: 'done' }]
        );
        expect(htmlWithRepoAndTable).toContain('Inactive');
        expect(htmlWithRepoAndTable).toContain('<a href="https://example.com/repo">');
        expect(htmlWithRepoAndTable).toContain('<table>');

        const htmlWithoutRepoAndNoPlans = (panelInstance as any).getHtml(
            { id: 'project-helpers', name: 'Helpers' },
            []
        );
        expect(htmlWithoutRepoAndNoPlans).toContain('Repo: —');
        expect(htmlWithoutRepoAndNoPlans).toContain('No plans are bound to this project.');

        const htmlWithFallbacks = (panelInstance as any).getHtml(null, [
            { code: 'plan-code-only', status: 'queued' },
            { id: 'plan-id-only' },
        ]);
        expect(htmlWithFallbacks).toContain('project-helpers');
        expect(htmlWithFallbacks).toContain('plan-code-only');
        expect(htmlWithFallbacks).toContain('queued');
        expect(htmlWithFallbacks).toContain('plan-id-only');

        expect((panelInstance as any).esc(123)).toBe('');
        expect((panelInstance as any).esc('<tag>"x"')).toContain('&lt;tag&gt;');
    });
});
