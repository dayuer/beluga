import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { getRandomBytes } from 'expo-crypto';
import { SECRET_SEAL_LABEL, type SealedBox } from '../../../src/studio/protocol.js';
import { fromBase64Url, toBase64Url } from './signed';

/**
 * 把明文封给一台节点（SS-226，`studio-env.md` §2）：
 * 临时 X25519 密钥对 + ECDH + HKDF-SHA256 + ChaCha20-Poly1305。
 * 临时私钥与明文都只在这个函数里，返回的只有密文；节点用同一套参数（`src/studio/verify.ts`）解开。
 */
export function sealToNode(nodeKey: string, plaintext: Uint8Array, aad: string): SealedBox {
  const nodePub = fromBase64Url(nodeKey);
  if (nodePub.length !== 32) throw new Error('node seal key has the wrong length');
  const ephSecret = getRandomBytes(32);
  const ephPublic = x25519.getPublicKey(ephSecret);
  const salt = new Uint8Array(64);
  salt.set(ephPublic, 0);
  salt.set(nodePub, 32);
  const shared = x25519.getSharedSecret(ephSecret, nodePub);
  const key = hkdf(sha256, shared, salt, new TextEncoder().encode(SECRET_SEAL_LABEL), 32);
  const nonce = getRandomBytes(12);
  const ct = chacha20poly1305(key, nonce, new TextEncoder().encode(aad)).encrypt(plaintext);
  return { nodeKey, epk: toBase64Url(ephPublic), nonce: toBase64Url(nonce), ct: toBase64Url(ct) };
}
