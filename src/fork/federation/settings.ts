/**
 * Federation (fork): whether this computer starts tasks teammates give it on its own (auto accept),
 * from whom, how many at once, and (milestone 2) the label of the claim pool. This computer's own:
 * it never travels with settings sync (machines/sync.ts LOCAL_SETTINGS).
 * Browser-safe (zod only): the daemon and the Mac app both read it.
 */
import { z } from 'zod';

/** off: nothing starts by itself; assigned: tasks given to me; pool: also claim from the pool (milestone 2). */
export const FEDERATION_ACCEPT = ['off', 'assigned', 'pool'] as const;
export type FederationAccept = (typeof FEDERATION_ACCEPT)[number];

/** Whose tasks start by themselves: only people you fully trust, or anyone you trust. */
export const FEDERATION_FROM = ['full', 'trusted'] as const;
export type FederationFrom = (typeof FEDERATION_FROM)[number];

export const ATONCE_MIN = 1;
export const ATONCE_MAX = 6;
export const ATONCE_DEFAULT = 2;
export const POOL_LABEL_DEFAULT = 'pool';

/** The saved shape: every field optional, read through `federationOf`. */
export const Federation = z.object({
  accept: z.enum(FEDERATION_ACCEPT).optional(),
  from: z.enum(FEDERATION_FROM).optional(),
  atOnce: z.number().int().min(ATONCE_MIN).max(ATONCE_MAX).optional(),
  poolLabel: z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/).optional(),
});
export type Federation = z.infer<typeof Federation>;

/** Federation with every field filled in. */
export interface FederationSettings {
  readonly accept: FederationAccept;
  readonly from: FederationFrom;
  readonly atOnce: number;
  readonly poolLabel: string;
}

export const FEDERATION_DEFAULTS: FederationSettings = Object.freeze({ accept: 'off', from: 'full', atOnce: ATONCE_DEFAULT, poolLabel: POOL_LABEL_DEFAULT });

/** The settings in force: each field that's unset or invalid falls back to its default on its own. */
export function federationOf(raw: unknown): FederationSettings {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const pick = <K extends keyof FederationSettings>(k: K): FederationSettings[K] => {
    const r = Federation.shape[k].safeParse(o[k]);
    return r.success && r.data !== undefined ? (r.data as FederationSettings[K]) : FEDERATION_DEFAULTS[k];
  };
  return { accept: pick('accept'), from: pick('from'), atOnce: pick('atOnce'), poolLabel: pick('poolLabel') };
}

/** A typed count kept within 1–6 (NaN: the default). */
export function clampAtOnce(n: number): number {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? ATONCE_DEFAULT : n > 0 ? ATONCE_MAX : ATONCE_MIN;
  return Math.min(ATONCE_MAX, Math.max(ATONCE_MIN, Math.round(n)));
}
