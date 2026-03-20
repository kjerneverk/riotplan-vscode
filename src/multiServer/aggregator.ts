import { HttpMcpClient } from '../mcp-client';
import { MultiServerConnectionManager } from './connectionManager';
import {
    isCatalogProjectUuid,
    pickWinningCatalogEntity,
} from './contextCatalogSync';
import { fromServerScopedRef, toServerScopedRef } from './types';

export interface MultiServerAggregatorOptions {
    /** One tree row per global catalog UUID (replicated context projects). */
    dedupeContextProjectsByCatalogId?: boolean;
    /** Used for scoped plan-like ids in the UI when deduping; falls back to first connected profile. */
    preferredServerIdForContextUi?: string;
}

interface ServerPlanShape {
    [key: string]: unknown;
    id?: string;
    uuid?: string;
    planId?: string;
    path?: string;
    code?: string;
    name?: string;
}

function parsePlansResult(result: any): ServerPlanShape[] {
    const content = result?.content?.[0];
    if (content?.type !== 'text') {
        return [];
    }
    try {
        const parsed = JSON.parse(content.text);
        return Array.isArray(parsed?.plans) ? parsed.plans : [];
    } catch {
        return [];
    }
}

function parseProjectsResult(raw: unknown): any[] {
    return Array.isArray(raw) ? raw : [];
}

function resolvePlanRef(plan: ServerPlanShape): string | undefined {
    const candidates = [plan.path, plan.planId, plan.id, plan.uuid, plan.code, plan.name];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }
    return undefined;
}

export class MultiServerAggregator {
    private readonly options: MultiServerAggregatorOptions;

    constructor(
        private readonly manager: MultiServerConnectionManager,
        options?: MultiServerAggregatorOptions
    ) {
        this.options = options || {};
    }

    async listPlans(filter?: 'all' | 'active' | 'done' | 'hold'): Promise<any> {
        const merged: any[] = [];
        const profiles = this.manager.getProfiles().filter((profile) => profile.enabled);
        await Promise.all(profiles.map(async (profile) => {
            const client = this.manager.getClient(profile.id);
            if (!client) {
                return;
            }
            const result = await client.listPlans(filter);
            const plans = parsePlansResult(result);
            for (const plan of plans) {
                const ref = resolvePlanRef(plan);
                merged.push({
                    ...plan,
                    serverId: profile.id,
                    serverName: profile.name,
                    sourceRef: ref,
                    planId: ref ? toServerScopedRef(profile.id, ref) : undefined,
                    path: ref ? toServerScopedRef(profile.id, ref) : undefined,
                    id: ref ? toServerScopedRef(profile.id, ref) : undefined,
                });
            }
        }));
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ plans: merged }),
                },
            ],
        };
    }

    async listContextProjects(includeInactive = true): Promise<any[]> {
        const merged: any[] = [];
        const profiles = this.manager.getProfiles().filter((profile) => profile.enabled);
        await Promise.all(profiles.map(async (profile) => {
            const client = this.manager.getClient(profile.id);
            if (!client) {
                return;
            }
            const projects = parseProjectsResult(await client.listContextProjects(includeInactive));
            for (const project of projects) {
                merged.push({
                    ...project,
                    serverId: profile.id,
                    serverName: profile.name,
                    id: project?.id ? toServerScopedRef(profile.id, String(project.id)) : undefined,
                });
            }
        }));

        if (!this.options.dedupeContextProjectsByCatalogId || merged.length === 0) {
            return merged;
        }

        const profileById = new Map(this.manager.getProfiles().map((p) => [p.id, p]));
        const statuses = new Map(this.manager.getStatuses().map((s) => [s.serverId, s]));

        const refProfile = (() => {
            const preferred = this.options.preferredServerIdForContextUi;
            if (preferred && profileById.has(preferred) && statuses.get(preferred)?.state === 'connected') {
                return profileById.get(preferred)!;
            }
            for (const p of this.manager.getProfiles()) {
                if (!p.enabled || statuses.get(p.id)?.state !== 'connected') {
                    continue;
                }
                return p;
            }
            return this.manager.getProfiles().find((p) => p.enabled) || profileById.values().next().value;
        })();

        if (!refProfile) {
            return merged;
        }

        const passthrough: any[] = [];
        const byUuid = new Map<string, any>();
        for (const row of merged) {
            const scoped = fromServerScopedRef(String(row.id || ''));
            const uuid = scoped?.value;
            if (!uuid || !isCatalogProjectUuid(uuid)) {
                passthrough.push(row);
                continue;
            }
            const prev = byUuid.get(uuid);
            if (!prev) {
                byUuid.set(uuid, row);
                continue;
            }
            byUuid.set(uuid, pickWinningCatalogEntity(prev, row));
        }

        const reScoped = [...byUuid.values()].map((row) => {
            const scoped = fromServerScopedRef(String(row.id || ''));
            const uuid = scoped?.value || '';
            return {
                ...row,
                serverId: refProfile.id,
                serverName: refProfile.name,
                id: toServerScopedRef(refProfile.id, uuid),
            };
        });

        return [...passthrough, ...reScoped];
    }

    getClientForServer(serverId: string): HttpMcpClient | undefined {
        return this.manager.getClient(serverId);
    }
}
