import { z } from 'zod';

/**
 * 手机端视图类型与宽松解析（SS-26）：
 * 依据 `docs/studio-ui.md` 卡片表与 `docs/studio-env.md`。
 * 所有对象使用宽松解析：未知字段不报错，未知卡片类型解析为 `unknown` 而不抛异常，
 * 以便后端 S1/S2 落地后只改此处解析、不改界面。
 */

export const WaitReasonSchema = z.enum(['offline', 'queued', 'quota', 'needs-human']);
export type WaitReason = z.infer<typeof WaitReasonSchema>;

export const RequestStatusSchema = z.enum(['working', 'needs-you', 'waiting', 'error', 'done']);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const StepStatusSchema = z.enum(['todo', 'active', 'waiting', 'done']);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const RequestStepSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: StepStatusSchema,
    waitReason: WaitReasonSchema.optional(),
    summary: z.string().optional(),
  })
  .passthrough();
export type RequestStep = z.infer<typeof RequestStepSchema>;

const CardBase = {
  id: z.string(),
  createdAt: z.number().default(0),
  status: z.enum(['pending', 'done', 'dismissed']).default('pending'),
  signed: z.boolean().optional(),
};

export const DesignCardSchema = z
  .object({
    ...CardBase,
    kind: z.literal('design'),
    fileCount: z.number(),
    totalBytes: z.number().default(0),
    imageCount: z.number().default(0),
    specCount: z.number().default(0),
    skipped: z
      .array(z.object({ name: z.string(), reason: z.string() }).passthrough())
      .default([]),
    manifestUrl: z.string().optional(),
  })
  .passthrough();

export const QuestionItemSchema = z
  .object({
    id: z.string(),
    index: z.number().int().min(1).default(1),
    prompt: z.string(),
    options: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            description: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    allowFreeText: z.boolean().default(true),
    answer: z.string().optional(),
  })
  .passthrough();

export const QuestionCardSchema = z
  .object({
    ...CardBase,
    kind: z.literal('question'),
    index: z.number().int().min(1).optional(),
    total: z.number().int().min(1).optional(),
    prompt: z.string(),
    options: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            description: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    allowFreeText: z.boolean().default(true),
    answer: z.string().optional(),
    questions: z.array(QuestionItemSchema).optional(),
  })
  .passthrough();

export const UnderstandingCardSchema = z
  .object({
    ...CardBase,
    kind: z.literal('understanding'),
    points: z.array(z.string()).default([]),
    outOfScope: z.array(z.string()).optional(),
    requiresSignature: z.boolean().default(true),
  })
  .passthrough();

export const StartCardSchema = z
  .object({
    ...CardBase,
    kind: z.literal('start'),
    planTitle: z.string(),
    stepCount: z.number().default(0),
    estimateLabel: z.string().optional(),
    requiresSignature: z.boolean().default(true),
  })
  .passthrough();

export const ChangesCardSchema = z
  .object({
    ...CardBase,
    kind: z.literal('changes'),
    summary: z.string(),
    added: z.array(z.string()).default([]),
    modified: z.array(z.string()).default([]),
    removed: z.array(z.string()).default([]),
    requiresSignature: z.boolean().default(true),
  })
  .passthrough();

export const StepsCardSchema = z
  .object({
    ...CardBase,
    kind: z.literal('steps'),
    steps: z.array(RequestStepSchema).default([]),
  })
  .passthrough();

export const WaitCardSchema = z
  .object({
    ...CardBase,
    kind: z.literal('wait'),
    reason: WaitReasonSchema,
    message: z.string(),
    etaText: z.string().optional(),
    customerAction: z.string().optional(),
  })
  .passthrough();

export const DeliveryCardSchema = z
  .object({
    ...CardBase,
    kind: z.literal('delivery'),
    round: z.number().default(1),
    summary: z.string(),
    previewUrl: z.string().optional(),
    installUrl: z.string().optional(),
    screenshots: z.array(z.string()).default([]),
    requiresSignature: z.boolean().default(true),
  })
  .passthrough();

export const CodeCardSchema = z
  .object({
    ...CardBase,
    kind: z.literal('code'),
    repoUrl: z.string(),
    prUrl: z.string().optional(),
    pushState: z.enum(['ready', 'pushed', 'failed']).default('ready'),
  })
  .passthrough();

export const ReleaseCardSchema = z
  .object({
    ...CardBase,
    kind: z.literal('release'),
    envId: z.string(),
    envTitle: z.string(),
    version: z.string(),
    lastVersion: z.string().optional(),
    lastReleaseAt: z.number().optional(),
    requiresSignature: z.boolean().default(true),
  })
  .passthrough();

export type KnownStudioCard =
  | z.infer<typeof DesignCardSchema>
  | z.infer<typeof QuestionCardSchema>
  | z.infer<typeof UnderstandingCardSchema>
  | z.infer<typeof StartCardSchema>
  | z.infer<typeof ChangesCardSchema>
  | z.infer<typeof StepsCardSchema>
  | z.infer<typeof WaitCardSchema>
  | z.infer<typeof DeliveryCardSchema>
  | z.infer<typeof CodeCardSchema>
  | z.infer<typeof ReleaseCardSchema>;

export interface UnknownStudioCard {
  id: string;
  kind: 'unknown';
  rawKind: string;
  createdAt: number;
  status: 'pending' | 'done' | 'dismissed';
  raw: Record<string, unknown>;
}

export type StudioCard = KnownStudioCard | UnknownStudioCard;

const KNOWN_CARD_SCHEMAS = {
  design: DesignCardSchema,
  question: QuestionCardSchema,
  understanding: UnderstandingCardSchema,
  start: StartCardSchema,
  changes: ChangesCardSchema,
  steps: StepsCardSchema,
  wait: WaitCardSchema,
  delivery: DeliveryCardSchema,
  code: CodeCardSchema,
  release: ReleaseCardSchema,
} as const;

/** 宽松解析单张卡片：已知类型按对应 schema 解析，未知类型或结构异常降级为 `unknown` 而不抛异常。 */
export function parseCard(raw: unknown): StudioCard {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const kind = typeof obj.kind === 'string' ? obj.kind : '';
    const schema = (KNOWN_CARD_SCHEMAS as Record<string, z.ZodTypeAny>)[kind];
    if (schema) {
      const res = schema.safeParse(obj);
      if (res.success) return res.data as KnownStudioCard;
    }
    return {
      id: typeof obj.id === 'string' ? obj.id : 'unknown',
      kind: 'unknown',
      rawKind: kind || 'invalid',
      createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : 0,
      status: obj.status === 'done' || obj.status === 'dismissed' ? obj.status : 'pending',
      raw: obj,
    };
  }
  return {
    id: 'unknown',
    kind: 'unknown',
    rawKind: 'invalid',
    createdAt: 0,
    status: 'pending',
    raw: {},
  };
}

export const StudioCardSchema = z.unknown().transform((val) => parseCard(val));

export const RequestSummarySchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    projectName: z.string(),
    title: z.string(),
    platform: z.string().default('web'),
    status: RequestStatusSchema,
    statusLine: z.string(),
    waitReason: WaitReasonSchema.optional(),
    errorAction: z.string().optional(),
    updatedAt: z.number(),
    unreadCount: z.number().optional(),
  })
  .passthrough();
export type RequestSummary = z.infer<typeof RequestSummarySchema>;

export const RequestMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['customer', 'ai', 'studio']),
    text: z.string(),
    createdAt: z.number(),
  })
  .passthrough();
export type RequestMessage = z.infer<typeof RequestMessageSchema>;

export const RequestArtifactSchema = z
  .object({
    id: z.string(),
    round: z.number().default(1),
    kind: z.enum(['preview', 'build', 'screenshot', 'note', 'attachment']),
    title: z.string(),
    url: z.string().optional(),
    createdAt: z.number().default(0),
  })
  .passthrough();

export const ResultDrawerViewSchema = z
  .object({
    artifacts: z.array(RequestArtifactSchema).default([]),
    attachments: z
      .array(z.object({ id: z.string(), name: z.string(), kind: z.string(), url: z.string().optional() }).passthrough())
      .default([]),
    plan: z
      .object({
        milestones: z.array(RequestStepSchema).default([]),
        activity: z.array(z.object({ id: z.string(), text: z.string(), at: z.number() }).passthrough()).default([]),
      })
      .passthrough()
      .default({ milestones: [], activity: [] }),
    changes: z
      .object({
        added: z.array(z.string()).default([]),
        modified: z.array(z.string()).default([]),
        removed: z.array(z.string()).default([]),
        pendingApproval: z.boolean().default(false),
      })
      .passthrough()
      .default({ added: [], modified: [], removed: [], pendingApproval: false }),
    previewUrl: z.string().optional(),
  })
  .passthrough();
export type ResultDrawerView = z.infer<typeof ResultDrawerViewSchema>;

export const RequestViewSchema = z
  .object({
    summary: RequestSummarySchema,
    messages: z.array(RequestMessageSchema).default([]),
    cards: z.array(StudioCardSchema).default([]),
    activeCardId: z.string().optional(),
    results: ResultDrawerViewSchema.default({
      artifacts: [],
      attachments: [],
      plan: { milestones: [], activity: [] },
      changes: { added: [], modified: [], removed: [], pendingApproval: false },
    }),
  })
  .passthrough();
export type RequestView = z.infer<typeof RequestViewSchema>;

// --- P1 / P2 / P7 / P8 屏视图（SS-147） ---

export const LoginViewSchema = z
  .object({
    email: z.string().default(''),
    inviteId: z.string().nullable().default(null),
    sent: z.boolean().default(false),
  })
  .passthrough();
export type LoginView = z.infer<typeof LoginViewSchema>;

export const NewRequestViewSchema = z
  .object({
    mode: z.enum(['new', 'feedback']).default('new'),
    projects: z.array(z.object({ id: z.string(), name: z.string(), platform: z.string() }).passthrough()).default([]),
    completedRequests: z.array(RequestSummarySchema).default([]),
    examples: z.array(z.string()).default([]),
  })
  .passthrough();
export type NewRequestView = z.infer<typeof NewRequestViewSchema>;

export const ReasonSheetViewSchema = z
  .object({
    requestId: z.string(),
    title: z.string(),
    quickTags: z.array(z.string()).default([]),
    draft: z.string().default(''),
  })
  .passthrough();
export type ReasonSheetView = z.infer<typeof ReasonSheetViewSchema>;

export const TodoScreenViewSchema = z
  .object({
    needsYou: z.array(StudioCardSchema).default([]),
    waiting: z.array(StudioCardSchema).default([]),
  })
  .passthrough();
export type TodoScreenView = z.infer<typeof TodoScreenViewSchema>;

// --- 设置各页的只读视图（studio-ui.md §3 & studio-env.md §1） ---

export const WhoViewSchema = z
  .object({
    name: z.string(),
    via: z.enum(['studio', 'setup']),
  })
  .passthrough();

export const EnvVarViewSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    at: z.number(),
    by: WhoViewSchema,
  })
  .passthrough();

export const EnvSecretMetaViewSchema = z
  .object({
    name: z.string(),
    purpose: z.string(),
    at: z.number(),
    by: WhoViewSchema,
    staleDays: z.number().optional(),
  })
  .passthrough();

export const StudioEnvViewSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    protected: z.boolean(),
    target: z
      .object({
        platform: z.string(),
        appId: z.string().optional(),
        mode: z.string(),
      })
      .passthrough(),
    vars: z.array(EnvVarViewSchema).default([]),
    secrets: z.array(EnvSecretMetaViewSchema).default([]),
    lastRelease: z
      .object({
        version: z.string(),
        at: z.number(),
        by: WhoViewSchema,
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type StudioEnvView = z.infer<typeof StudioEnvViewSchema>;

export const ProjectSettingViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    platform: z.string(),
    runMode: z.enum(['every-step', 'auto-delivery']),
    prodEnabled: z.boolean().default(true),
  })
  .passthrough();
export type ProjectSettingView = z.infer<typeof ProjectSettingViewSchema>;

export const ForgeSettingViewSchema = z
  .object({
    projectId: z.string(),
    mode: z.enum(['preview-only', 'repo', 'push-mine']),
    repoUrl: z.string().optional(),
    hasToken: z.boolean().default(false),
    tokenUpdatedAt: z.number().optional(),
  })
  .passthrough();
export type ForgeSettingView = z.infer<typeof ForgeSettingViewSchema>;

export const RunnerNodeViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    online: z.boolean(),
    accepting: z.boolean(),
    activeRequestCount: z.number().default(0),
    monthlyQuotaUsed: z.number().optional(),
    monthlyQuotaLimit: z.number().optional(),
  })
  .passthrough();
export type RunnerNodeView = z.infer<typeof RunnerNodeViewSchema>;

export const DeviceViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    platform: z.string(),
    registeredAt: z.number(),
    lastSeenAt: z.number().optional(),
    isCurrent: z.boolean().optional(),
  })
  .passthrough();
export type DeviceView = z.infer<typeof DeviceViewSchema>;

export const AccountViewSchema = z
  .object({
    email: z.string(),
    pushEnabled: z.boolean().default(true),
    appearance: z.enum(['light', 'dark', 'system']).default('system'),
  })
  .passthrough();
export type AccountView = z.infer<typeof AccountViewSchema>;

export const SettingsViewSchema = z
  .object({
    projects: z.array(ProjectSettingViewSchema).default([]),
    envs: z.record(z.string(), z.array(StudioEnvViewSchema)).default({}),
    forges: z.array(ForgeSettingViewSchema).default([]),
    runners: z.array(RunnerNodeViewSchema).default([]),
    devices: z.array(DeviceViewSchema).default([]),
    account: AccountViewSchema,
  })
  .passthrough();
export type SettingsView = z.infer<typeof SettingsViewSchema>;

export function parseRequestSummary(raw: unknown): RequestSummary | null {
  const res = RequestSummarySchema.safeParse(raw);
  return res.success ? res.data : null;
}

export function parseRequestView(raw: unknown): RequestView | null {
  const res = RequestViewSchema.safeParse(raw);
  return res.success ? res.data : null;
}

export function parseSettingsView(raw: unknown): SettingsView | null {
  const res = SettingsViewSchema.safeParse(raw);
  return res.success ? res.data : null;
}

export function parseLoginView(raw: unknown): LoginView | null {
  const res = LoginViewSchema.safeParse(raw);
  return res.success ? res.data : null;
}

export function parseNewRequestView(raw: unknown): NewRequestView | null {
  const res = NewRequestViewSchema.safeParse(raw);
  return res.success ? res.data : null;
}

export function parseReasonSheetView(raw: unknown): ReasonSheetView | null {
  const res = ReasonSheetViewSchema.safeParse(raw);
  return res.success ? res.data : null;
}

export function parseTodoScreenView(raw: unknown): TodoScreenView | null {
  const res = TodoScreenViewSchema.safeParse(raw);
  return res.success ? res.data : null;
}

export function parseResultDrawerView(raw: unknown): ResultDrawerView | null {
  const res = ResultDrawerViewSchema.safeParse(raw);
  return res.success ? res.data : null;
}
