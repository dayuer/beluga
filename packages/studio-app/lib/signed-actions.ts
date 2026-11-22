import { SECRET_MAX_BYTES, secretAad, type DeliveryMode, type SignedEnvelopeWire, type StudioAction } from '../../../src/studio/protocol.js';
import { sealToNode } from './seal';

/**
 * S2 六个签名动作的强类型构造函数（SS-173）：
 * 1) 确认理解 `request.confirm`
 * 2) 批准开工 `gate.answer(start)`
 * 3) 批准改动 `gate.answer(changes)`
 * 4) 通过 `delivery.accept`
 * 5) 批准上线 `release.approve`
 * 6) 移除设备 `device.remove`
 * M13 追加两个（SS-226）：填密钥 `secret.set`、改项目设置 `settings.update`。
 *
 * 传给 `useSend` 时可先不带 `signed`（由 `lib/send.ts` 补齐签名信封），也可直接传入 `signed` 得到完整 `StudioAction`。
 */

export type RequestConfirmDraft = Omit<Extract<StudioAction, { kind: 'request.confirm' }>, 'signed'> & {
  readonly signed?: SignedEnvelopeWire;
};
export type GateAnswerDraft = Omit<Extract<StudioAction, { kind: 'gate.answer' }>, 'signed'> & {
  readonly signed?: SignedEnvelopeWire;
};
export type DeliveryAcceptDraft = Omit<Extract<StudioAction, { kind: 'delivery.accept' }>, 'signed'> & {
  readonly signed?: SignedEnvelopeWire;
};
export type ReleaseApproveDraft = Omit<Extract<StudioAction, { kind: 'release.approve' }>, 'signed'> & {
  readonly signed?: SignedEnvelopeWire;
};
export type DeviceRemoveDraft = Omit<Extract<StudioAction, { kind: 'device.remove' }>, 'signed'> & {
  readonly signed?: SignedEnvelopeWire;
};
export type SecretSetDraft = Omit<Extract<StudioAction, { kind: 'secret.set' }>, 'signed'> & {
  readonly signed?: SignedEnvelopeWire;
};
export type SettingsUpdateDraft = Omit<Extract<StudioAction, { kind: 'settings.update' }>, 'signed'> & {
  readonly signed?: SignedEnvelopeWire;
};

export type SignedActionDraft =
  | RequestConfirmDraft
  | GateAnswerDraft
  | DeliveryAcceptDraft
  | ReleaseApproveDraft
  | DeviceRemoveDraft
  | SecretSetDraft
  | SettingsUpdateDraft;

export function buildConfirmUnderstanding(params: {
  readonly opId: string;
  readonly planRef: string;
  readonly rev: number;
  readonly signed?: SignedEnvelopeWire;
}): RequestConfirmDraft {
  return {
    t: 'action',
    opId: params.opId,
    kind: 'request.confirm',
    planRef: params.planRef,
    payload: {},
    rev: params.rev,
    ...(params.signed ? { signed: params.signed } : {}),
  };
}

export function buildApproveStart(params: {
  readonly opId: string;
  readonly planRef: string;
  readonly draftRev: number;
  readonly reason?: string;
  readonly signed?: SignedEnvelopeWire;
}): GateAnswerDraft {
  return {
    t: 'action',
    opId: params.opId,
    kind: 'gate.answer',
    planRef: params.planRef,
    payload: {
      gate: 'start',
      approved: true,
      draftRev: params.draftRev,
      ...(params.reason !== undefined ? { reason: params.reason } : {}),
    },
    rev: params.draftRev,
    ...(params.signed ? { signed: params.signed } : {}),
  };
}

export function buildApproveChanges(params: {
  readonly opId: string;
  readonly planRef: string;
  readonly draftRev: number;
  readonly reason?: string;
  readonly signed?: SignedEnvelopeWire;
}): GateAnswerDraft {
  return {
    t: 'action',
    opId: params.opId,
    kind: 'gate.answer',
    planRef: params.planRef,
    payload: {
      gate: 'changes',
      approved: true,
      draftRev: params.draftRev,
      ...(params.reason !== undefined ? { reason: params.reason } : {}),
    },
    rev: params.draftRev,
    ...(params.signed ? { signed: params.signed } : {}),
  };
}

export function buildAcceptDelivery(params: {
  readonly opId: string;
  readonly planRef: string;
  readonly milestoneRef: string;
  readonly draftRev: number;
  readonly signed?: SignedEnvelopeWire;
}): DeliveryAcceptDraft {
  return {
    t: 'action',
    opId: params.opId,
    kind: 'delivery.accept',
    planRef: params.planRef,
    payload: {
      milestoneRef: params.milestoneRef,
      draftRev: params.draftRev,
    },
    rev: params.draftRev,
    ...(params.signed ? { signed: params.signed } : {}),
  };
}

export function buildApproveRelease(params: {
  readonly opId: string;
  readonly planRef: string;
  readonly releaseId?: string;
  readonly draftRev?: number;
  readonly signed?: SignedEnvelopeWire;
}): ReleaseApproveDraft {
  return {
    t: 'action',
    opId: params.opId,
    kind: 'release.approve',
    planRef: params.planRef,
    payload: {
      ...(params.releaseId !== undefined ? { releaseId: params.releaseId } : {}),
      ...(params.draftRev !== undefined ? { draftRev: params.draftRev } : {}),
    },
    ...(params.draftRev !== undefined ? { rev: params.draftRev } : {}),
    ...(params.signed ? { signed: params.signed } : {}),
  };
}

export function buildRemoveDevice(params: {
  readonly opId: string;
  readonly deviceId: string;
  readonly signed?: SignedEnvelopeWire;
}): DeviceRemoveDraft {
  return {
    t: 'action',
    opId: params.opId,
    kind: 'device.remove',
    payload: {
      deviceId: params.deviceId,
    },
    ...(params.signed ? { signed: params.signed } : {}),
  };
}

/** 值太大或为空：界面上说清楚，别发出去（`SECRET_MAX_BYTES`）。 */
export class SecretValueError extends Error {
  readonly code = 'BAD_SECRET' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SecretValueError';
  }
}

/**
 * 填写或更新一个密钥（SS-226）：值在这一个函数里封给节点，明文不进返回值。
 * 返回的动作里只有密文，之后由 `lib/send.ts` 补签名信封。
 */
export function buildSecretSet(params: {
  readonly opId: string;
  readonly projectId: string;
  readonly envId: string;
  readonly name: string;
  readonly purpose: string;
  readonly value: string;
  readonly nodeSealKey: string;
  readonly signed?: SignedEnvelopeWire;
}): SecretSetDraft {
  const bytes = new TextEncoder().encode(params.value);
  if (bytes.length === 0) throw new SecretValueError('密钥不能为空');
  if (bytes.length > SECRET_MAX_BYTES) throw new SecretValueError(`密钥不能超过 ${SECRET_MAX_BYTES} 字节`);
  const sealed = sealToNode(params.nodeSealKey, bytes, secretAad(params.projectId, params.envId, params.name));
  return {
    t: 'action',
    opId: params.opId,
    kind: 'secret.set',
    payload: {
      projectId: params.projectId,
      envId: params.envId,
      name: params.name,
      purpose: params.purpose,
      sealed,
    },
    ...(params.signed ? { signed: params.signed } : {}),
  };
}

/** 改项目设置（SS-226）：只发白名单里的字段。 */
export function buildUpdateSettings(params: {
  readonly opId: string;
  readonly projectId: string;
  readonly delivery?: DeliveryMode;
  readonly repoUrl?: string;
  readonly signed?: SignedEnvelopeWire;
}): SettingsUpdateDraft {
  // `{}` 不是一次改动：至少给一项，和协议的白名单一致。
  if (params.delivery === undefined && params.repoUrl === undefined) throw new Error('settings.update needs at least one field');
  const settings: SettingsUpdateDraft['payload']['settings'] =
    params.delivery !== undefined
      ? { delivery: params.delivery, ...(params.repoUrl !== undefined ? { repoUrl: params.repoUrl } : {}) }
      : { repoUrl: params.repoUrl as string };
  return {
    t: 'action',
    opId: params.opId,
    kind: 'settings.update',
    payload: { projectId: params.projectId, settings },
    ...(params.signed ? { signed: params.signed } : {}),
  };
}
