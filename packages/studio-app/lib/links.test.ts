import { describe, expect, it } from 'vitest';
import { getHubHost, parseDeepLink } from './links';

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
    expect(parseDeepLink('synon://me/devices/add', HUB)).toBe('/me/devices/add');
  });

  it('parses all https:// routes matching EXPO_PUBLIC_HUB_URL', () => {
    expect(parseDeepLink('https://studio.example.com/join/inv_123#k=sec&n=Bob', HUB)).toBe('/join/inv_123#k=sec&n=Bob');
    expect(parseDeepLink('https://studio.example.com/request/req_42', HUB)).toBe('/request/req_42');
    expect(parseDeepLink('https://studio.example.com/request/req_42?card=c_9', HUB)).toBe('/request/req_42?card=c_9');
    expect(parseDeepLink('https://studio.example.com/login?token=tok_abc', HUB)).toBe('/login?token=tok_abc');
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
    expect(parseDeepLink('synon://me/devices', HUB)).toBeNull();
  });
});
