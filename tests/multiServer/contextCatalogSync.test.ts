import { describe, expect, it } from 'vitest';
import {
    CATALOG_REVISION_FIELD,
    CATALOG_UPDATED_AT_FIELD,
    mergeCatalogFromPerServerProjects,
    pickWinningCatalogEntity,
    stampNewCatalogMetadata,
} from '../../src/multiServer/contextCatalogSync';

describe('contextCatalogSync', () => {
    it('pickWinningCatalogEntity prefers newer catalogUpdatedAt over higher revision', () => {
        const olderTimeHigherRev = {
            id: 'a',
            [CATALOG_REVISION_FIELD]: 99,
            [CATALOG_UPDATED_AT_FIELD]: '2020-01-01T00:00:00.000Z',
        };
        const newerTimeLowerRev = {
            id: 'a',
            [CATALOG_REVISION_FIELD]: 1,
            [CATALOG_UPDATED_AT_FIELD]: '2025-01-01T00:00:00.000Z',
        };
        expect(pickWinningCatalogEntity(olderTimeHigherRev, newerTimeLowerRev)).toBe(newerTimeLowerRev);
    });

    it('pickWinningCatalogEntity uses catalogRevision when timestamps match', () => {
        const a = { id: 'a', [CATALOG_REVISION_FIELD]: 3, [CATALOG_UPDATED_AT_FIELD]: '2024-01-01T00:00:00.000Z' };
        const b = { id: 'a', [CATALOG_REVISION_FIELD]: 5, [CATALOG_UPDATED_AT_FIELD]: '2024-01-01T00:00:00.000Z' };
        expect(pickWinningCatalogEntity(a, b)).toBe(b);
    });

    it('mergeCatalogFromPerServerProjects unions by UUID', () => {
        const shared = 'fae4cd7a-8510-41a9-974e-6954ccfc515b';
        const merged = mergeCatalogFromPerServerProjects([
            {
                serverId: 's1',
                projects: [
                    {
                        id: shared,
                        name: 'Old',
                        [CATALOG_REVISION_FIELD]: 1,
                        [CATALOG_UPDATED_AT_FIELD]: '2020-01-01T00:00:00.000Z',
                    },
                ],
            },
            {
                serverId: 's2',
                projects: [
                    {
                        id: shared,
                        name: 'Newer',
                        [CATALOG_REVISION_FIELD]: 5,
                        [CATALOG_UPDATED_AT_FIELD]: '2021-01-01T00:00:00.000Z',
                    },
                ],
            },
        ]);
        expect(merged.size).toBe(1);
        expect(merged.get(shared)?.name).toBe('Newer');
    });

    it('stampNewCatalogMetadata sets revision and timestamp', () => {
        const e: Record<string, unknown> = { id: 'x', name: 'X' };
        stampNewCatalogMetadata(e);
        expect(e[CATALOG_REVISION_FIELD]).toBe(1);
        expect(typeof e[CATALOG_UPDATED_AT_FIELD]).toBe('string');
    });
});
