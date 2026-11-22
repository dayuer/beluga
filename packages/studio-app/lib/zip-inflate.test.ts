import { describe, expect, it } from 'vitest';
import { crc32, inflateRawStream } from './zip-inflate';

async function loadZlib() {
  return (await import(/* @vite-ignore */ 'node:zlib' as string)) as {
    deflateRawSync(buf: Uint8Array): Uint8Array;
  };
}

describe('zip-inflate', () => {
  it('decompresses RFC 1951 deflate stream (stored + fixed + dynamic huffman) matching original bytes', async () => {
    const zlib = await loadZlib();
    // 构造包含高重复文本（触发 dynamic huffman）和随机字节的大缓冲区
    const textPart = new TextEncoder().encode('Synon Studio Design Spec — '.repeat(2500));
    const binPart = new Uint8Array(20000);
    for (let i = 0; i < binPart.length; i++) {
      binPart[i] = (i * 73 + (i >> 3)) & 0xff;
    }
    const original = new Uint8Array(textPart.length + binPart.length);
    original.set(textPart, 0);
    original.set(binPart, textPart.length);

    const compressed = zlib.deflateRawSync(original);
    const expectedCrc = crc32(original);

    // 每次只喂 4096 字节，验证跨块边界流式解压
    let offset = 0;
    const chunks: Uint8Array[] = [];
    const result = await inflateRawStream({
      expectedSize: original.byteLength,
      expectedCrc32: expectedCrc,
      outputChunkBytes: 8192,
      pullChunk: async () => {
        if (offset >= compressed.byteLength) return null;
        const slice = compressed.subarray(offset, offset + 4096);
        offset += slice.byteLength;
        return slice;
      },
      onOutput: (chunk) => {
        chunks.push(new Uint8Array(chunk));
      },
    });

    const out = new Uint8Array(result.totalBytes);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.byteLength;
    }

    expect(result.totalBytes).toBe(original.byteLength);
    expect(result.crc32).toBe(expectedCrc);
    expect(out).toEqual(original);
  });

  it('throws on CRC32 mismatch', async () => {
    const zlib = await loadZlib();
    const original = new TextEncoder().encode('hello deflate world');
    const compressed = zlib.deflateRawSync(original);
    let sent = false;

    await expect(
      inflateRawStream({
        expectedSize: original.byteLength,
        expectedCrc32: (crc32(original) ^ 0xffffffff) >>> 0,
        pullChunk: async () => {
          if (sent) return null;
          sent = true;
          return compressed;
        },
        onOutput: () => {},
      }),
    ).rejects.toThrow('zip-crc32-mismatch');
  });
});
