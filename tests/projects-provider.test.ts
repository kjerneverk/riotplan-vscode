import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
    class EventEmitter<T> {
        event = (_listener: T) => ({ dispose: () => {} });
        fire = () => {};
    }
    class TreeItem {
        label: string;
        collapsibleState: number;
        description?: string;
        tooltip?: string;
        contextValue?: string;
        iconPath?: unknown;
        command?: unknown;
        constructor(label: string, collapsibleState: number) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    }
    class ThemeColor {
        id: string;
        constructor(id: string) {
            this.id = id;
        }
    }
    class ThemeIcon {
        id: string;
        color?: ThemeColor;
        constructor(id: string, color?: ThemeColor) {
            this.id = id;
            this.color = color;
        }
    }
    return {
        EventEmitter,
        TreeItem,
        ThemeColor,
        ThemeIcon,
        TreeItemCollapsibleState: {
            None: 0,
            Collapsed: 1,
            Expanded: 2,
        },
    };
});

import { ProjectItem, ProjectsTreeProvider } from '../src/projects-provider';

describe('ProjectsTreeProvider', () => {
    it('sorts projects by name and exposes project context value', async () => {
        const listContextProjects = vi.fn(async () => [
            { id: 'p-2', name: 'Zeta' },
            { id: 'p-1', name: 'Alpha' },
        ]);
        const provider = new ProjectsTreeProvider({ listContextProjects } as any);

        const items = await provider.getChildren();

        expect(listContextProjects).toHaveBeenCalledWith(true);
        expect(items).toHaveLength(2);
        expect(items[0].label).toBe('Alpha');
        expect(items[1].label).toBe('Zeta');
        expect(items[0].contextValue).toBe('project');
    });

    it('returns empty list when loading projects fails', async () => {
        const listContextProjects = vi.fn(async () => {
            throw new Error('network failure');
        });
        const provider = new ProjectsTreeProvider({ listContextProjects } as any);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const items = await provider.getChildren();

        expect(items).toEqual([]);
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('supports updateClient, refresh, and getTreeItem passthrough', () => {
        const firstClient = { listContextProjects: vi.fn(async () => []) };
        const secondClient = { listContextProjects: vi.fn(async () => []) };
        const provider = new ProjectsTreeProvider(firstClient as any);
        const fireSpy = vi.spyOn((provider as any)._onDidChangeTreeData, 'fire');

        provider.updateClient(secondClient as any);
        provider.refresh();
        const projectItem = provider.getTreeItem({
            label: 'Any',
            collapsibleState: 0,
        } as any);

        expect((provider as any).mcpClient).toBe(secondClient);
        expect(fireSpy).toHaveBeenCalled();
        expect(projectItem.label).toBe('Any');
    });
});

describe('ProjectItem', () => {
    it('uses inactive icon and status-only description when id equals label', () => {
        const item = new ProjectItem({
            id: 'repo-1',
            name: 'repo-1',
            active: false,
        });

        expect(item.label).toBe('repo-1');
        expect(item.description).toBe('Inactive');
        expect((item.iconPath as any)?.id).toBe('circle-slash');
    });

    it('falls back to default label when id and name are missing', () => {
        const item = new ProjectItem({});

        expect(item.label).toBe('Unnamed project');
        expect(item.tooltip).toBe('Unnamed project');
        expect(item.description).toBe('Active');
        expect((item.iconPath as any)?.id).toBe('project');
    });

    it('sorts projects using id when names are missing', async () => {
        const listContextProjects = vi.fn(async () => [
            { id: 'z-id' },
            { id: 'a-id' },
            { name: 'Named' },
        ]);
        const provider = new ProjectsTreeProvider({ listContextProjects } as any);

        const items = await provider.getChildren();

        expect(items[0].label).toBe('a-id');
        expect(items[1].label).toBe('Named');
        expect(items[2].label).toBe('z-id');
    });
});
