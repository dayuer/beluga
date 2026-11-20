/**
 * 纯 TypeScript RFC 1951 (raw Deflate) 流式解压器与 CRC32 校验（SS-156）。
 * 零外部依赖，适合在 React Native / Hermes 环境下低内存流式解压 `.zip` 内的 method 8 条目。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32Update(crc: number, data: Uint8Array): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ (data[i] ?? 0)) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function crc32(data: Uint8Array): number {
  return crc32Update(0, data);
}

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
  2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
  13,
];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface HuffmanTable {
  readonly maxBits: number;
  readonly table: Int32Array;
}

function reverseBits(code: number, bits: number): number {
  let r = 0;
  for (let i = 0; i < bits; i++) {
    r = (r << 1) | (code & 1);
    code >>>= 1;
  }
  return r;
}

function buildHuffmanTable(lengths: readonly number[]): HuffmanTable {
  let maxBits = 0;
  for (const l of lengths) {
    if (l > maxBits) maxBits = l;
  }
  if (maxBits === 0) {
    return { maxBits: 1, table: new Int32Array(2).fill(-1) };
  }

  const counts = new Uint16Array(maxBits + 1);
  for (const l of lengths) {
    if (l > 0) counts[l] = (counts[l] ?? 0) + 1;
  }

  const nextCode = new Uint32Array(maxBits + 1);
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits++) {
    code = (code + (counts[bits - 1] ?? 0)) << 1;
    nextCode[bits] = code;
  }

  const tableSize = 1 << maxBits;
  const table = new Int32Array(tableSize).fill(-1);

  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym] ?? 0;
    if (len === 0) continue;
    const c = nextCode[len] ?? 0;
    nextCode[len] = c + 1;
    const rev = reverseBits(c, len);
    const val = (len << 16) | sym;
    const step = 1 << len;
    for (let idx = rev; idx < tableSize; idx += step) {
      table[idx] = val;
    }
  }

  return { maxBits, table };
}

const FIXED_LIT_TABLE = (() => {
  const lens = new Array<number>(288);
  for (let i = 0; i <= 143; i++) lens[i] = 8;
  for (let i = 144; i <= 255; i++) lens[i] = 9;
  for (let i = 256; i <= 279; i++) lens[i] = 7;
  for (let i = 280; i <= 287; i++) lens[i] = 8;
  return buildHuffmanTable(lens);
})();

const FIXED_DIST_TABLE = (() => {
  const lens = new Array<number>(32).fill(5);
  return buildHuffmanTable(lens);
})();

class AsyncBitReader {
  private buf = new Uint8Array(0);
  private pos = 0;
  private bitBuf = 0;
  private bitCount = 0;
  private eof = false;

  constructor(private readonly pull: () => Promise<Uint8Array | null>) {}

  private async ensureBytes(minBytes: number): Promise<void> {
    while (this.buf.length - this.pos < minBytes && !this.eof) {
      const next = await this.pull();
      if (!next || next.length === 0) {
        this.eof = true;
        break;
      }
      const remaining = this.buf.subarray(this.pos);
      const merged = new Uint8Array(remaining.length + next.length);
      merged.set(remaining, 0);
      merged.set(next, remaining.length);
      this.buf = merged;
      this.pos = 0;
    }
  }

  async ensureBits(n: number): Promise<void> {
    if (this.bitCount >= n) return;
    await this.ensureBytes(Math.ceil((n - this.bitCount) / 8));
    while (this.bitCount < n && this.pos < this.buf.length) {
      this.bitBuf |= (this.buf[this.pos++] ?? 0) << this.bitCount;
      this.bitCount += 8;
    }
  }

  async readBits(n: number): Promise<number> {
    if (n === 0) return 0;
    await this.ensureBits(n);
    if (this.bitCount < n) {
      throw new Error('invalid-deflate: unexpected EOF');
    }
    const val = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCount -= n;
    return val;
  }

  async decodeSymbol(ht: HuffmanTable): Promise<number> {
    await this.ensureBits(ht.maxBits);
    const mask = (1 << ht.maxBits) - 1;
    const entry = ht.table[this.bitBuf & mask] ?? -1;
    if (entry < 0) {
      throw new Error('invalid-deflate: bad huffman code');
    }
    const len = entry >>> 16;
    if (this.bitCount < len) {
      throw new Error('invalid-deflate: unexpected EOF');
    }
    this.bitBuf >>>= len;
    this.bitCount -= len;
    return entry & 0xffff;
  }

  alignToByte(): void {
    const drop = this.bitCount & 7;
    this.bitBuf >>>= drop;
    this.bitCount -= drop;
  }

  async readAlignedUint16(): Promise<number> {
    const lo = await this.readBits(8);
    const hi = await this.readBits(8);
    return lo | (hi << 8);
  }

  async readAlignedBytes(len: number): Promise<Uint8Array> {
    const out = new Uint8Array(len);
    let written = 0;
    while (written < len && this.bitCount >= 8) {
      out[written++] = this.bitBuf & 0xff;
      this.bitBuf >>>= 8;
      this.bitCount -= 8;
    }
    while (written < len) {
      await this.ensureBytes(1);
      if (this.pos >= this.buf.length) {
        throw new Error('invalid-deflate: truncated stored block');
      }
      const take = Math.min(len - written, this.buf.length - this.pos);
      out.set(this.buf.subarray(this.pos, this.pos + take), written);
      this.pos += take;
      written += take;
    }
    return out;
  }
}

export interface InflateStreamOptions {
  readonly pullChunk: () => Promise<Uint8Array | null>;
  readonly onOutput: (chunk: Uint8Array) => Promise<void> | void;
  readonly expectedSize?: number;
  readonly expectedCrc32?: number;
  readonly outputChunkBytes?: number;
}

/**
 * 流式解压 raw Deflate 数据流，并在结束时校验输出字节数与 CRC32。
 */
export async function inflateRawStream(options: InflateStreamOptions): Promise<{
  readonly totalBytes: number;
  readonly crc32: number;
}> {
  const reader = new AsyncBitReader(options.pullChunk);
  const windowSize = 32768;
  const windowBuf = new Uint8Array(windowSize);
  let winPos = 0;

  const flushThreshold = options.outputChunkBytes ?? 64 * 1024;
  let outBuf = new Uint8Array(flushThreshold);
  let outPos = 0;
  let totalBytes = 0;
  let runningCrc = 0;

  const flushOut = async () => {
    if (outPos === 0) return;
    const slice = outBuf.subarray(0, outPos);
    runningCrc = crc32Update(runningCrc, slice);
    await options.onOutput(slice);
    totalBytes += outPos;
    outPos = 0;
  };

  const emitByte = async (b: number) => {
    windowBuf[winPos] = b;
    winPos = (winPos + 1) & 32767;
    outBuf[outPos++] = b;
    if (outPos >= flushThreshold) {
      await flushOut();
    }
  };

  const emitBlock = async (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) {
      await emitByte(bytes[i]!);
    }
  };

  let isFinal = 0;
  do {
    isFinal = await reader.readBits(1);
    const btype = await reader.readBits(2);

    if (btype === 0) {
      reader.alignToByte();
      const len = await reader.readAlignedUint16();
      const nlen = await reader.readAlignedUint16();
      if ((len ^ 0xffff) !== nlen) {
        throw new Error('invalid-deflate: stored block length mismatch');
      }
      const block = await reader.readAlignedBytes(len);
      await emitBlock(block);
    } else if (btype === 1 || btype === 2) {
      let litTable = FIXED_LIT_TABLE;
      let distTable = FIXED_DIST_TABLE;

      if (btype === 2) {
        const hlit = (await reader.readBits(5)) + 257;
        const hdist = (await reader.readBits(5)) + 1;
        const hclen = (await reader.readBits(4)) + 4;

        const clLengths = new Array<number>(19).fill(0);
        for (let i = 0; i < hclen; i++) {
          clLengths[CL_ORDER[i]!] = await reader.readBits(3);
        }
        const clTable = buildHuffmanTable(clLengths);

        const allLengths = new Array<number>(hlit + hdist).fill(0);
        let idx = 0;
        while (idx < allLengths.length) {
          const sym = await reader.decodeSymbol(clTable);
          if (sym < 16) {
            allLengths[idx++] = sym;
          } else if (sym === 16) {
            if (idx === 0) throw new Error('invalid-deflate: repeat with no previous code');
            const repeat = 3 + (await reader.readBits(2));
            const prev = allLengths[idx - 1]!;
            for (let r = 0; r < repeat && idx < allLengths.length; r++) {
              allLengths[idx++] = prev;
            }
          } else if (sym === 17) {
            const repeat = 3 + (await reader.readBits(3));
            idx += repeat;
          } else if (sym === 18) {
            const repeat = 11 + (await reader.readBits(7));
            idx += repeat;
          } else {
            throw new Error(`invalid-deflate: bad code length symbol ${sym}`);
          }
        }

        litTable = buildHuffmanTable(allLengths.slice(0, hlit));
        distTable = buildHuffmanTable(allLengths.slice(hlit));
      }

      for (;;) {
        const sym = await reader.decodeSymbol(litTable);
        if (sym < 256) {
          await emitByte(sym);
        } else if (sym === 256) {
          break;
        } else {
          const lenIdx = sym - 257;
          if (lenIdx >= LEN_BASE.length) {
            throw new Error(`invalid-deflate: bad length symbol ${sym}`);
          }
          const length = LEN_BASE[lenIdx]! + (await reader.readBits(LEN_EXTRA[lenIdx]!));
          const distSym = await reader.decodeSymbol(distTable);
          if (distSym >= DIST_BASE.length) {
            throw new Error(`invalid-deflate: bad distance symbol ${distSym}`);
          }
          const distance = DIST_BASE[distSym]! + (await reader.readBits(DIST_EXTRA[distSym]!));
          for (let k = 0; k < length; k++) {
            const b = windowBuf[(winPos - distance) & 32767]!;
            await emitByte(b);
          }
        }
      }
    } else {
      throw new Error(`invalid-deflate: reserved block type ${btype}`);
    }
  } while (isFinal === 0);

  await flushOut();

  if (options.expectedSize !== undefined && totalBytes !== options.expectedSize) {
    throw new Error(`zip-size-mismatch: expected ${options.expectedSize}, got ${totalBytes}`);
  }
  if (options.expectedCrc32 !== undefined && runningCrc !== (options.expectedCrc32 >>> 0)) {
    throw new Error(
      `zip-crc32-mismatch: expected ${(options.expectedCrc32 >>> 0).toString(16)}, got ${runningCrc.toString(16)}`,
    );
  }

  return { totalBytes, crc32: runningCrc };
}
