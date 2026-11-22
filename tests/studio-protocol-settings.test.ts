import {
  createCipheriv,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SECRET_SEAL_LABEL, secretAad, StudioAction } from '../src/studio/protocol.js';
import { canonicalJson, createDeviceTrustStore, openSealedBox, SEAL_LABEL } from '../src/studio/verify.js';

/**
 * M13 / SS-226：手机临时填密钥（`secret.set`）与改项目设置（`settings.update`）两个签名动作。
 * 全部只用 `node:crypto` 与 zod：设备侧封装、节点侧验签与解封都在这里，和 App 的 `lib/seal.ts` 同一套参数。
 * 任务书：登记设备的两个动作验签通过；没登记、签名错、时钟回退分别被拒；假节点解出原值；中台的字节里没有明文。
 */

const OP = '6f1c2a5e-3b7d-4c8e-9f0a-1b2c3d4e5f60';
const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex');

/** 与 `lib/seal.ts` 相同的封装格式：临时 X25519 + HKDF-SHA256 + ChaCha20-Poly1305。 */
function sealToNode(nodeKey: string, plaintext: Buffer, aad: string) {
  const nodeRaw = Buffer.from(nodeKey, 'base64url');
  const nodePublic = createPublicKey({ key: Buffer.concat([X25519_SPKI, nodeRaw]), format: 'der', type: 'spki' });
  const ephemeral = generateKeyPairSync('x25519');
  const epk = Buffer.from(ephemeral.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: nodePublic });
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.concat([epk, nodeRaw]), Buffer.from(SECRET_SEAL_LABEL), 32));
  const nonce = Buffer.alloc(12, 3);
  const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { nodeKey, epk: epk.toString('base64url'), nonce: nonce.toString('base64url'), ct: body.toString('base64url') };
}

const rawPublic = (key: KeyObject): Buffer =>
  (key.type === 'public' ? key : createPublicKey(key)).export({ type: 'spki', format: 'der' }).subarray(-32);

const inviteK = Buffer.alloc(32, 9);
const phone = generateKeyPairSync('ed25519');
const phoneRaw = rawPublic(phone.publicKey);
const phoneKey = phoneRaw.toString('base64url');
const phoneMac = createHmac('sha256', inviteK).update(phoneRaw).digest('base64url');

/** 一台登记过这台手机的节点：信任名单 + X25519 封装密钥。 */
function enrolledNode() {
  const trust = createDeviceTrustStore({ nodeFingerprint: 'A1B2C3D4E5F67890' });
  trust.addInvite('inv-1', inviteK.toString('base64url'));
  expect(trust.enrollFrame({ inviteId: 'inv-1', pubkey: phoneKey, mac: phoneMac, deviceId: 'dev_1' })).toEqual({ ok: true, fingerprint: 'A1B2C3D4E5F67890' });
  const sealPair = generateKeyPairSync('x25519');
  return { trust, sealPair, sealPublic: rawPublic(sealPair.publicKey).toString('base64url') };
}

const signedBy = <P>(priv: KeyObject, deviceKey: string, kind: string, payload: P, at: number) => {
  const frame = { kind, payload, at, deviceKey };
  return {
    t: 'action' as const,
    opId: OP,
    kind,
    payload,
    signed: { frame, sig: sign(null, Buffer.from(canonicalJson(frame)), priv).toString('base64url') },
  };
};

describe('secret.set and settings.update (M13, node:crypto + zod only)', () => {
  it('the two sealed labels used by app and node are the same string', () => {
    expect(SEAL_LABEL).toBe(SECRET_SEAL_LABEL);
  });

  it('a registered device signs secret.set and settings.update; both parse and verify', () => {
    const { trust, sealPublic } = enrolledNode();
    const secretAction = signedBy(
      phone.privateKey,
      phoneKey,
      'secret.set',
      {
        projectId: 'proj-1',
        envId: 'test',
        name: 'STRIPE_SECRET_KEY',
        purpose: '收款的密钥',
        sealed: sealToNode(sealPublic, Buffer.from('sk_live_example'), secretAad('proj-1', 'test', 'STRIPE_SECRET_KEY')),
      },
      100,
    );
    expect(StudioAction.safeParse(secretAction).success).toBe(true);
    expect(trust.verifySignedAction(secretAction)).toEqual({ ok: true });

    const settingsAction = signedBy(
      phone.privateKey,
      phoneKey,
      'settings.update',
      { projectId: 'proj-1', settings: { delivery: 'repo', repoUrl: 'https://github.com/me/app' } },
      101,
    );
    expect(StudioAction.safeParse(settingsAction).success).toBe(true);
    expect(trust.verifySignedAction(settingsAction)).toEqual({ ok: true });
  });

  it('the node opens the sealed value, and no plaintext reaches the bytes sent to the hub', () => {
    const { sealPair, sealPublic } = enrolledNode();
    const plaintext = 'sk_live_51N7verysecretvalue';
    const aad = secretAad('proj-1', 'test', 'STRIPE_SECRET_KEY');
    const action = signedBy(
      phone.privateKey,
      phoneKey,
      'secret.set',
      { projectId: 'proj-1', envId: 'test', name: 'STRIPE_SECRET_KEY', purpose: '收款的密钥', sealed: sealToNode(sealPublic, Buffer.from(plaintext), aad) },
      200,
    );

    const opened = openSealedBox(action.payload.sealed, sealPublic, sealPair.privateKey, aad);
    expect(opened?.toString('utf8')).toBe(plaintext);

    // 中台看到的整帧（含签名帧与规范化 JSON）里，明文与它的 base64 都搜不到。
    for (const wire of [JSON.stringify(action), canonicalJson(action), JSON.stringify(action.signed.frame)]) {
      expect(wire).not.toContain(plaintext);
      expect(wire).not.toContain('sk_live');
      expect(wire).not.toContain(Buffer.from(plaintext).toString('base64url'));
    }

    // AAD 绑住项目 / 环境 / 名字：换一个名字解不开。
    expect(openSealedBox(action.payload.sealed, sealPublic, sealPair.privateKey, secretAad('proj-1', 'test', 'OTHER_KEY'))).toBeUndefined();
    // 封给别的节点的，这把私钥也解不开。
    const otherPub = rawPublic(generateKeyPairSync('x25519').publicKey).toString('base64url');
    expect(openSealedBox(action.payload.sealed, otherPub, sealPair.privateKey, aad)).toBeUndefined();
  });

  it('refuses an unregistered device, a bad signature and a clock that goes back', () => {
    const { trust, sealPublic } = enrolledNode();
    const payload = { projectId: 'proj-1', envId: 'test', name: 'API_TOKEN', purpose: '接口', sealed: sealToNode(sealPublic, Buffer.from('v1'), secretAad('proj-1', 'test', 'API_TOKEN')) };

    const other = generateKeyPairSync('ed25519');
    const otherKey = rawPublic(other.publicKey).toString('base64url');
    expect(trust.verifySignedAction(signedBy(other.privateKey, otherKey, 'secret.set', payload, 300))).toEqual({ ok: false, code: 'unregistered-device' });

    const tampered = signedBy(phone.privateKey, phoneKey, 'secret.set', payload, 301);
    tampered.signed.sig = Buffer.alloc(64, 0).toString('base64url');
    expect(trust.verifySignedAction(tampered)).toEqual({ ok: false, code: 'bad-signature' });

    expect(trust.verifySignedAction(signedBy(phone.privateKey, phoneKey, 'secret.set', payload, 302))).toEqual({ ok: true });
    expect(trust.verifySignedAction(signedBy(phone.privateKey, phoneKey, 'settings.update', { projectId: 'proj-1', settings: { delivery: 'preview' } }, 302))).toEqual({ ok: false, code: 'stale-clock' });

    const settingsTampered = signedBy<{ projectId: string; settings: { delivery: string; repoUrl?: string } }>(
      phone.privateKey,
      phoneKey,
      'settings.update',
      { projectId: 'proj-1', settings: { delivery: 'preview' } },
      303,
    );
    settingsTampered.payload = { projectId: 'proj-1', settings: { delivery: 'repo', repoUrl: 'https://github.com/me/app' } };
    expect(trust.verifySignedAction(settingsTampered)).toEqual({ ok: false, code: 'bad-signature' });
  });

  it('the protocol keeps secret.set and settings.update to their whitelists', () => {
    const { sealPublic } = enrolledNode();
    const sealed = sealToNode(sealPublic, Buffer.from('v1'), secretAad('proj-1', 'test', 'API_TOKEN'));
    const ok = (payload: unknown, kind = 'secret.set') => StudioAction.safeParse({ t: 'action', opId: OP, kind, payload, signed: { frame: { kind, payload, at: 1, deviceKey: 'A' }, sig: 'B' } });
    expect(ok({ projectId: 'proj-1', envId: 'test', name: 'API_TOKEN', purpose: '接口', sealed }).success).toBe(true);
    expect(ok({ projectId: 'proj-1', envId: 'test', name: 'api_token', purpose: '接口', sealed }).success).toBe(false);
    expect(ok({ projectId: 'proj-1', envId: 'test', name: 'A', purpose: '接口', sealed, extra: 1 }).success).toBe(false);
    expect(ok({ projectId: 'proj-1', settings: { delivery: 'preview' } }, 'settings.update').success).toBe(true);
    expect(ok({ projectId: 'proj-1', settings: { repoUrl: 'https://github.com/me/app' } }, 'settings.update').success).toBe(true);
    expect(ok({ projectId: 'proj-1', settings: {} }, 'settings.update').success).toBe(false);
    expect(ok({ projectId: 'proj-1', settings: { delivery: 'ftp' } }, 'settings.update').success).toBe(false);
    expect(ok({ projectId: 'proj-1', settings: { delivery: 'preview', apiKey: 'x' } }, 'settings.update').success).toBe(false);
    expect(ok({ projectId: 'proj-1', settings: { delivery: 'repo', repoUrl: 'http://insecure.example' } }, 'settings.update').success).toBe(false);
  });
});
