import { describe, expect, it } from 'vitest';
import { getHubHost, parseDeepLink, resolveNativeIntent } from './links';

const HUB = 'https://studio.example.com';

describe('getHubHost', () => {
  it('extracts lowercase host from EXPO_PUBLIC_HUB_URL', () => {
    expect(getHubHost('https://Studio.Example.COM/api')).toBe('studio.example.com');
    expect(getHubHost('https://hub.example.com:8443')).toBe('hub.example.com:8443');
    expect(getHubHost('')).toBeNull();
    expect(getHubHost('not a url')).toBeNull();
  });
});

describe('parseDeepLink', () => {
  it('parses all synon:// routes', () => {
    expect(parseDeepLink('synon://join/inv_123#k=secret&n=Alice', HUB)).toBe('/join/inv_123#k=secret&n=Alice');
    expect(parseDeepLink('synon:///join/inv_123#k=secret&n=Alice', HUB)).toBe('/join/inv_123#k=secret&n=Alice');
    expect(parseDeepLink('synon://request/req_42', HUB)).toBe('/request/req_42');
    expect(parseDeepLink('synon://request/req_42?card=c_9', HUB)).toBe('/request/req_42?card=c_9');
    expect(parseDeepLink('synon://login?token=tok_abc', HUB)).toBe('/login?token=tok_abc');
    expect(parseDeepLink('synon://login#token=tok_hash', HUB)).toBe('/login?token=tok_hash');
    expect(parseDeepLink('synon://me/devices/add', HUB)).toBe('/me/devices/add');
  });

  it('parses all https:// routes matching EXPO_PUBLIC_HUB_URL', () => {
    expect(parseDeepLink('https://studio.example.com/join/inv_123#k=sec&n=Bob', HUB)).toBe('/join/inv_123#k=sec&n=Bob');
    expect(parseDeepLink('https://studio.example.com/request/req_42', HUB)).toBe('/request/req_42');
    expect(parseDeepLink('https://studio.example.com/request/req_42?card=c_9', HUB)).toBe('/request/req_42?card=c_9');
    expect(parseDeepLink('https://studio.example.com/login?token=tok_abc', HUB)).toBe('/login?token=tok_abc');
    expect(parseDeepLink('https://studio.example.com/login#token=tok_hash', HUB)).toBe('/login?token=tok_hash');
    expect(parseDeepLink('https://studio.example.com/me/devices/add', HUB)).toBe('/me/devices/add');
  });

  it('rejects bad links, foreign https hosts, and missing required params', () => {
    expect(parseDeepLink(null, HUB)).toBeNull();
    expect(parseDeepLink('', HUB)).toBeNull();
    expect(parseDeepLink('not a url', HUB)).toBeNull();
    expect(parseDeepLink('http://studio.example.com/request/req_1', HUB)).toBeNull();
    expect(parseDeepLink('https://evil.example.com/request/req_1', HUB)).toBeNull();
    expect(parseDeepLink('https://studio.example.com/request/req_1', undefined)).toBeNull();
    expect(parseDeepLink('synon://unknown/path', HUB)).toBeNull();
    expect(parseDeepLink('synon://join/', HUB)).toBeNull();
    expect(parseDeepLink('synon://join/a/b', HUB)).toBeNull();
    expect(parseDeepLink('synon://request/', HUB)).toBeNull();
    expect(parseDeepLink('synon://login', HUB)).toBeNull();
    expect(parseDeepLink('synon://login?token=', HUB)).toBeNull();
    expect(parseDeepLink('synon://login#token=', HUB)).toBeNull();
    expect(parseDeepLink('synon://me/devices', HUB)).toBeNull();
  });
});

describe('resolveNativeIntent', () => {
  it('passes through in-app paths and dev-client URLs untouched', () => {
    expect(resolveNativeIntent('/', HUB)).toBe('/');
    expect(resolveNativeIntent('/todo', HUB)).toBe('/todo');
    expect(resolveNativeIntent('/me', HUB)).toBe('/me');
    const devClient = 'exp+synon-studio://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081';
    expect(resolveNativeIntent(devClient, HUB)).toBe(devClient);
    const synonDevClient = 'synon://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081';
    expect(resolveNativeIntent(synonDevClient, HUB)).toBe(synonDevClient);
  });

  it('rewrites hub #token= login links and drops malformed synon:// links', () => {
    expect(resolveNativeIntent('https://studio.example.com/login#token=abc', HUB)).toBe('/login?token=abc');
    expect(resolveNativeIntent('synon://unknown/path', HUB)).toBeNull();
  });
});
