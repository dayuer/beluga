import type { SignedEnvelopeWire, StudioAction } from '../../../src/studio/protocol.js';

/**
 * S2 六个签名动作的强类型构造函数（SS-173）：
 * 1) 确认理解 `request.confirm`
 * 2) 批准开工 `gate.answer(start)`
 * 3) 批准改动 `gate.answer(changes)`
 * 4) 通过 `delivery.accept`
 * 5) 批准上线 `release.approve`
 * 6) 移除设备 `device.remove`
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

export type SignedActionDraft =
  | RequestConfirmDraft
  | GateAnswerDraft
  | DeliveryAcceptDraft
  | ReleaseApproveDraft
  | DeviceRemoveDraft;

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
