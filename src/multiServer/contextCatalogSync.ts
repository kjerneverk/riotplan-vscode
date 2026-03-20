import { randomUUID } from 'node:crypto';
import { HttpMcpClient } from '../mcp-client';
import { MultiServerConnectionManager } from './connectionManager';

/** Bumps on each local write; tie-break when two replicas share the same `catalogUpdatedAt`. */
export const CATALOG_REVISION_FIELD = 'catalogRevision';
/** ISO-8601 UTC timestamp; primary merge ordering (lexicographic compare). */
export const CATALOG_UPDATED_AT_FIELD = 'catalogUpdatedAt';

/** Same shape as riotplan-mcp-http UUID check (RFC 4122 variant). */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCatalogProjectUuid(value: string): boolean {
    return UUID_V4_PATTERN.test(String(value || '').trim());
}

export function stripReplicationTransportFields<T extends Record<string, unknown>>(entity: T): T {
    const next = { ...entity };
    delete (next as any).serverId;
    delete (next as any).serverName;
    return next;
}

export function getCatalogRevision(entity: unknown): number {
    const raw = typeof entity === 'object' && entity !== null ? (entity as any)[CATALOG_REVISION_FIELD] : undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function getCatalogUpdatedAt(entity: unknown): string {
    const raw =
        typeof entity === 'object' && entity !== null ? String((entity as any)[CATALOG_UPDATED_AT_FIELD] || '') : '';
    return raw.trim();
}

/** Prefer cryptographically random UUIDs (collision probability negligible). */
export function newCatalogProjectId(): string {
    return randomUUID();
}

export function stampNewCatalogMetadata(entity: Record<string, unknown>): void {
    entity[CATALOG_REVISION_FIELD] = 1;
    entity[CATALOG_UPDATED_AT_FIELD] = new Date().toISOString();
}

export function bumpCatalogMetadata(entity: Record<string, unknown>): void {
    const nextRev = getCatalogRevision(entity) + 1;
    entity[CATALOG_REVISION_FIELD] = nextRev;
    entity[CATALOG_UPDATED_AT_FIELD] = new Date().toISOString();
}

/**
 * Pick the “newer” replica. Deliberately simple:
 * - Assume `catalogUpdatedAt` is ISO-8601 from this extension or compatible servers (lexicographic compare is OK for UTC Zulu).
 * - Same timestamp → higher `catalogRevision` wins (bump on local writes).
 * - Still tied → prefer `b` (stable “last candidate wins” when folding lists).
 */
export function pickWinningCatalogEntity<T extends Record<string, unknown>>(a: T, b: T): T {
    const at = getCatalogUpdatedAt(a);
    const bt = getCatalogUpdatedAt(b);
    if (at !== bt) {
        return bt > at ? b : a;
    }
    const ar = getCatalogRevision(a);
    const br = getCatalogRevision(b);
    if (br !== ar) {
        return br > ar ? b : a;
    }
    return b;
}

/**
 * Union UUID projects from each server; one row per id. Non-UUID ids are ignored here
 * (full sync only replicates catalog UUID rows).
 */
export function mergeCatalogFromPerServerProjects(
    perServer: Array<{ serverId: string; projects: any[] }>
): Map<string, Record<string, unknown>> {
    const candidates = new Map<string, Record<string, unknown>[]>();

    for (const { projects } of perServer) {
        for (const raw of projects) {
            if (!raw || typeof raw !== 'object') {
                continue;
            }
            const id = String((raw as any).id || '').trim();
            if (!isCatalogProjectUuid(id)) {
                continue;
            }
            const cleaned = stripReplicationTransportFields({ ...(raw as any) }) as Record<string, unknown>;
            cleaned.id = id;
            const list = candidates.get(id) || [];
            list.push(cleaned);
            candidates.set(id, list);
        }
    }

    const winners = new Map<string, Record<string, unknown>>();
    for (const [id, list] of candidates) {
        if (list.length === 0) {
            continue;
        }
        let best = list[0];
        for (let i = 1; i < list.length; i += 1) {
            best = pickWinningCatalogEntity(best, list[i]);
        }
        winners.set(id, { ...best, id });
    }
    return winners;
}

export interface ContextCatalogSyncResult {
    entityCount: number;
    connectedServers: number;
    upsertsOk: number;
    upsertsFailed: number;
    errors: string[];
}

export class ContextCatalogSyncEngine {
    constructor(private readonly manager: MultiServerConnectionManager) {}

    private connectedProfiles(): Array<{ id: string; name: string; client: HttpMcpClient }> {
        const statuses = new Map(this.manager.getStatuses().map((s) => [s.serverId, s]));
        const out: Array<{ id: string; name: string; client: HttpMcpClient }> = [];
        for (const profile of this.manager.getProfiles()) {
            if (!profile.enabled) {
                continue;
            }
            const st = statuses.get(profile.id);
            if (st?.state !== 'connected') {
                continue;
            }
            const client = this.manager.getClient(profile.id);
            if (!client) {
                continue;
            }
            out.push({ id: profile.id, name: profile.name, client });
        }
        return out;
    }

    /**
     * Fetch all projects from connected servers, merge UUID rows (newer `catalogUpdatedAt` wins), upsert full catalog to every connected server.
     */
    async runFullSync(): Promise<ContextCatalogSyncResult> {
        const errors: string[] = [];
        const connected = this.connectedProfiles();
        if (connected.length === 0) {
            return {
                entityCount: 0,
                connectedServers: 0,
                upsertsOk: 0,
                upsertsFailed: 0,
                errors: [],
            };
        }

        const snapshots: Array<{ serverId: string; projects: any[] }> = [];
        await Promise.all(
            connected.map(async ({ id, client }) => {
                try {
                    const projects = await client.listContextProjects(true);
                    snapshots.push({ serverId: id, projects: Array.isArray(projects) ? projects : [] });
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    errors.push(`${id}: list failed: ${msg}`);
                    snapshots.push({ serverId: id, projects: [] });
                }
            })
        );

        const merged = mergeCatalogFromPerServerProjects(snapshots);
        const entities = [...merged.values()];

        let upsertsOk = 0;
        let upsertsFailed = 0;

        await Promise.all(
            connected.map(async ({ id: _targetId, name: targetName, client }) => {
                for (const entity of entities) {
                    const payload = stripReplicationTransportFields({ ...entity });
                    try {
                        await client.upsertContextProject(payload);
                        upsertsOk += 1;
                    } catch (e) {
                        upsertsFailed += 1;
                        const msg = e instanceof Error ? e.message : String(e);
                        errors.push(`${targetName}: upsert ${payload.id}: ${msg}`);
                    }
                }
            })
        );

        return {
            entityCount: entities.length,
            connectedServers: connected.length,
            upsertsOk,
            upsertsFailed,
            errors,
        };
    }

    async bumpAndPush(entity: Record<string, unknown>): Promise<{ ok: number; failed: number; errors: string[] }> {
        bumpCatalogMetadata(entity);
        return await this.pushEntityToAllConnected(entity);
    }

    /** Push one entity to every connected server (edit / create propagation). */
    async pushEntityToAllConnected(entity: Record<string, unknown>): Promise<{ ok: number; failed: number; errors: string[] }> {
        const connected = this.connectedProfiles();
        const errors: string[] = [];
        let ok = 0;
        let failed = 0;
        const payload = stripReplicationTransportFields({ ...entity });
        await Promise.all(
            connected.map(async ({ name, client }) => {
                try {
                    await client.upsertContextProject(payload);
                    ok += 1;
                } catch (e) {
                    failed += 1;
                    errors.push(`${name}: ${String(payload.id)}: ${e instanceof Error ? e.message : String(e)}`);
                }
            })
        );
        return { ok, failed, errors };
    }
}
