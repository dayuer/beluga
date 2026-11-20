import { PermissionsAndroid, Platform } from 'react-native';
import type { Lang } from './strings';
import { tVoice } from './strings/voice';
import type { VoiceRecognizer } from './voice';

/**
 * 真的语音输入（SS-218）：照 companion 的做法录音 + 本地 Whisper 识别，不再只是占位。
 *
 * - 录音：`@fugood/react-native-audio-pcm-stream`，16 kHz 单声道 16-bit PCM，和 companion 一样；
 * - 识别：`whisper.rn`（whisper.cpp），模型文件首次使用时下载到应用文档目录并校验字节数；
 *   模型与地址和 companion 的 Whisper Base 完全一致（src/shared/voice-models.ts）；
 * - 权限：iOS 用 expo-camera 的 `Camera.requestMicrophonePermissionsAsync()` 真的弹系统授权，
 *   Android 走 PermissionsAndroid 的 RECORD_AUDIO。
 *
 * 原生模块都是用时才 require，所以纯逻辑（测试里注入假录音流和假 whisper）不碰任何原生代码。
 */

/** Whisper 的采样率，录音也用它。 */
export const SAMPLE_RATE = 16_000;
/** 一次录音最长 2 分钟。 */
export const MAX_SECONDS = 120;
const MAX_BYTES = SAMPLE_RATE * 2 * MAX_SECONDS;

/** companion 用的 Whisper Base（src/shared/voice-models.ts 的 whisper-base.files.phone）。 */
const MODEL = {
  name: 'ggml-base-q5_1.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
  bytes: 59_707_625,
} as const;

/** 测试注入的三件原生事：要权限、开/停录音、把 PCM 写成文字。 */
export interface RecognizerDeps {
  requestPermission(platform: string): Promise<boolean>;
  startRecording(push: (samples: Float32Array) => void): Promise<void>;
  stopRecording(): void;
  transcribe(pcm: Uint8Array, lang: Lang): Promise<string>;
}

/* ---------- 录下来的声音 ---------- */

/** 多个 Float32 块拼起来，按 MAX_BYTES 截断，转成 16-bit 小端 PCM。 */
export function pcm16Of(chunks: readonly Float32Array[]): Uint8Array {
  let frames = 0;
  for (const c of chunks) frames += c.length;
  frames = Math.min(frames, MAX_BYTES >> 1);
  const out = new Uint8Array(frames * 2);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length && at < frames; i++, at++) {
      const s = Math.max(-1, Math.min(1, chunk[i] ?? 0));
      view.setInt16(at * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    if (at >= frames) break;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;

/** 录音流的 base64 块 → 字节（不依赖 atob，Hermes 上也能用）。 */
export function fromB64(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64_LOOKUP[clean.charCodeAt(i)]! << 18) |
      (B64_LOOKUP[clean.charCodeAt(i + 1)]! << 12) |
      ((B64_LOOKUP[clean.charCodeAt(i + 2)] ?? 0) << 6) |
      (B64_LOOKUP[clean.charCodeAt(i + 3)] ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** 16-bit PCM 字节 → [-1, 1] 的浮点（录音流和 whisper 都按这个说话）。 */
export function floatsOf(pcm: Uint8Array): Float32Array {
  const n = pcm.length >> 1;
  const view = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/* ---------- 原生模块（用时才加载） ---------- */

interface AudioStream {
  init(o: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    audioSource: number;
    bufferSize: number;
    wavFile: string;
  }): Promise<void>;
  on(event: 'data', cb: (b64: string) => void): void;
  start(): void;
  stop(): void;
}

interface WhisperContext {
  transcribeData(
    pcm: ArrayBuffer,
    opts: { language?: string; prompt?: string },
  ): { promise: Promise<{ result: string }> };
}

interface WhisperModule {
  initWhisper(o: { filePath: string }): Promise<WhisperContext>;
}

type Fs = typeof import('expo-file-system');
type CameraModule = typeof import('expo-camera');

// RN 的 ESM 包经 Babel 编译后默认导出在 `.default` 上，两种都认。
function audioStream(): AudioStream {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@fugood/react-native-audio-pcm-stream') as AudioStream & { default?: AudioStream };
  return mod.default ?? mod;
}

function whisper(): WhisperModule {
  // whisper.rn 只导出子路径（没有 '.'），所以是 'index'；它的 react-native 入口是 TS 源码，
  // 这里按运行时 require，用自己的最小类型。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('whisper.rn/index') as WhisperModule & { default?: WhisperModule };
  return mod.default ?? mod;
}

async function requestMicrophone(platform: string): Promise<boolean> {
  if (platform === 'android') {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return r === PermissionsAndroid.RESULTS.GRANTED;
  }
  if (platform === 'ios') {
    // iOS 的麦克风授权只能由系统弹（NSMicrophoneUsageDescription 已在 app.json 里）。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Camera } = require('expo-camera') as CameraModule;
    const r = await Camera.requestMicrophonePermissionsAsync();
    return Boolean(r.granted);
  }
  return false;
}

/**
 * 原生录音器在 stop 之后还要在自己的线程上放掉 AudioRecord（一个缓冲，约 64 ms）；
 * 这之前重新 start，旧线程会释放新的录音器然后空指针崩溃。所以下一次 start 等上一次停稳。
 */
const SETTLE_MS = 300;
let settled: Promise<void> = Promise.resolve();

async function startMicStream(push: (samples: Float32Array) => void): Promise<void> {
  await settled;
  const stream = audioStream();
  await stream.init({
    sampleRate: SAMPLE_RATE,
    channels: 1,
    bitsPerSample: 16,
    audioSource: 6, // VOICE_RECOGNITION：不降噪、不增益，交给 Whisper
    bufferSize: 2048,
    wavFile: '',
  });
  stream.on('data', (b64) => push(floatsOf(fromB64(b64))));
  stream.start();
}

function stopMicStream(): void {
  audioStream().stop();
  settled = new Promise((r) => setTimeout(r, SETTLE_MS));
}

/* ---------- 模型 ---------- */

let loaded: Promise<WhisperContext> | undefined;

/** 模型：首次下载到文档目录的 voice/ 下，先写 .part，字节数对得上才算好。 */
async function ensureModel(): Promise<InstanceType<Fs['File']>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Directory, File, Paths } = require('expo-file-system') as Fs;
  const dir = new Directory(Paths.document, 'voice');
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, MODEL.name);
  if (file.exists && file.size === MODEL.bytes) return file;

  const part = new File(dir, `${MODEL.name}.part`);
  if (part.exists) part.delete();
  await File.downloadFileAsync(MODEL.url, part);
  if (part.size !== MODEL.bytes) {
    part.delete();
    throw new Error('The voice model came incomplete. Try again on a steadier connection.');
  }
  if (file.exists) file.delete();
  part.move(file);
  return file;
}

async function contextFor(file: { uri: string }): Promise<WhisperContext> {
  if (!loaded) {
    loaded = whisper()
      .initWhisper({ filePath: file.uri })
      .catch((e: unknown) => {
        loaded = undefined;
        throw e;
      });
  }
  return loaded;
}

/** 一段 16-bit PCM → 文字（Whisper Base，本机识别，声音不离开手机）。 */
async function transcribeOnDevice(pcm: Uint8Array, lang: Lang): Promise<string> {
  const ctx = await contextFor(await ensureModel());
  const copy = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
  const { result } = await ctx.transcribeData(copy, { language: lang }).promise;
  return result ?? '';
}

const nativeDeps: RecognizerDeps = {
  requestPermission: requestMicrophone,
  startRecording: startMicStream,
  stopRecording: stopMicStream,
  transcribe: transcribeOnDevice,
};

/* ---------- 识别器 ---------- */

/** 默认的 VoiceRecognizer：真的录音、真的识别。测试可以只替换需要的那几件。 */
export function createVoiceRecognizer(overrides: Partial<RecognizerDeps> = {}): VoiceRecognizer {
  const deps: RecognizerDeps = { ...nativeDeps, ...overrides };
  let lang: Lang = 'zh';
  let collecting = false;
  let recording = false;
  let chunks: Float32Array[] = [];
  let frames = 0;

  return {
    async requestPermission(want, platform = Platform.OS) {
      lang = want;
      const granted = await deps.requestPermission(platform).catch(() => false);
      return granted ? { granted: true } : { granted: false, message: tVoice(want, 'voice.micDenied') };
    },

    async start() {
      chunks = [];
      frames = 0;
      collecting = true;
      await deps.startRecording((samples) => {
        if (!collecting) return;
        const room = (MAX_BYTES >> 1) - frames;
        if (room <= 0) return;
        const take = samples.length > room ? samples.subarray(0, room) : samples;
        chunks.push(take);
        frames += take.length;
      });
      recording = true;
    },

    async stop() {
      if (!recording) {
        collecting = false;
        return '';
      }
      collecting = false;
      recording = false;
      deps.stopRecording();
      const pcm = pcm16Of(chunks);
      chunks = [];
      frames = 0;
      if (!pcm.length) return '';
      return deps.transcribe(pcm, lang);
    },

    async cancel() {
      collecting = false;
      chunks = [];
      frames = 0;
      if (!recording) return;
      recording = false;
      deps.stopRecording();
    },
  };
}
