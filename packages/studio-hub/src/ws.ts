/**
 * The little that is specific to a socket: its attachment (who it is) and its tags (how to find it
 * again after hibernation). All state a hibernated DO needs is here or in SQLite, never in fields.
 */

export interface DaemonAttachment {
  readonly role: 'daemon';
  readonly daemonId: string;
  /** The connection's signature timestamp: a replaced socket can tell it no longer owns the daemon. */
  readonly at: number;
}

export interface AppAttachment {
  readonly role: 'app';
  readonly customerId: string;
  readonly projectId: string;
  readonly sessionHash?: string;
}

export type Attachment = DaemonAttachment | AppAttachment;

export const attachmentOf = (ws: WebSocket): Attachment | undefined => {
  try {
    const att = ws.deserializeAttachment() as Record<string, unknown> | null;
    if (!att || typeof att.role !== 'string') return undefined;
    if (att.role === 'daemon' && typeof att.daemonId === 'string' && typeof att.at === 'number') return { role: 'daemon', daemonId: att.daemonId, at: att.at };
    if (att.role === 'app' && typeof att.customerId === 'string' && typeof att.projectId === 'string') {
      return { role: 'app', customerId: att.customerId, projectId: att.projectId, ...(typeof att.sessionHash === 'string' ? { sessionHash: att.sessionHash } : {}) };
    }
    return undefined;
  } catch {
    return undefined;
  }
};

export const daemonTags = (daemonId: string): string[] => [`daemon:${daemonId}`];

/** Broadcasts find `app:<project>`; removal finds `cust:<customer>`; logout finds `sess:<hash>`. */
export const appTags = (customerId: string, projectId: string, sessionHash?: string): string[] => [
  `app:${projectId}`,
  `cust:${customerId}`,
  ...(sessionHash !== undefined ? [`sess:${sessionHash}`] : []),
];
