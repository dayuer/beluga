import { describe, expect, it } from 'vitest';
import { CLIENT_METHODS, clientRefusal, topicInProject } from '../src/companion/client-scope.js';
import { phoneMay } from '../src/companion/coverage.js';
import type { DomainState } from '../src/core/store.js';

/** A customer's phone (BLG-15): a short list of methods, and only its own project's conversations. */

const state = {
  projects: [
    { id: 'shop', name: 'Shop', workspaces: [{ id: 'w1', archived: false }, { id: 'old', archived: true }] },
    { id: 'other', name: 'Other', workspaces: [{ id: 'w2', archived: false }] },
  ],
  approvals: [
    { id: 'a1', channel: 'ws:w1' },
    { id: 'a2', channel: 'ws:w2' },
    { id: 'a3' },
  ],
  questions: [
    { qid: 'q1', channel: 'ws:w1' },
    { qid: 'q2', channel: 'ws:w2' },
  ],
} as unknown as DomainState;

const refuse = (method: string, args: unknown[]) => clientRefusal(state, 'shop', method, args);

describe('what a client may call', () => {
  it('lets it talk in, and answer cards of, its own project', () => {
    expect(refuse('session.submit', ['hi', { channel: 'ws:w1' }])).toBeUndefined();
    expect(refuse('host.answerApproval', ['once', 'a1'])).toBeUndefined();
    expect(refuse('questions.answer', ['q1', {}])).toBeUndefined();
    expect(refuse('questions.pick', ['q1', 'x', 'y'])).toBeUndefined();
    expect(refuse('companion.older', ['client:w1', { before: 'm' }])).toBeUndefined();
  });

  it('refuses every method off its list, including what your own phone may do', () => {
    for (const m of ['companion.files.read', 'companion.files.list', 'companion.termOpen', 'companion.terminals', 'companion.merge', 'plans.approve', 'board.start', 'session.setPrefs', 'sentinel.run', 'nope.nothing']) {
      expect(refuse(m, [])).toMatch(/available/);
    }
    // The list is a strict subset of what the owner's phone may do.
    for (const m of CLIENT_METHODS) expect(phoneMay(m)).toBe(true);
  });

  it('refuses other projects, the room, Your Mac and archived worktrees', () => {
    expect(refuse('session.submit', ['hi', { channel: 'ws:w2' }])).toBeDefined();
    expect(refuse('session.submit', ['hi', { channel: 'ws:old' }])).toBeDefined();
    expect(refuse('session.submit', ['hi', { channel: 'room' }])).toBeDefined();
    expect(refuse('session.submit', ['hi', { channel: 'mac:assistant' }])).toBeDefined();
    expect(refuse('session.submit', ['hi'])).toBeDefined();
    expect(refuse('session.submit', ['hi', null])).toBeDefined();
    expect(refuse('host.answerApproval', ['once', 'a2'])).toBeDefined();
    expect(refuse('host.answerApproval', ['once', 'a3'])).toBeDefined();
    expect(refuse('host.answerApproval', ['once', 'missing'])).toBeDefined();
    expect(refuse('questions.answer', ['q2', {}])).toBeDefined();
    expect(refuse('questions.pick', ['nope', 'x', 'y'])).toBeDefined();
    expect(refuse('companion.older', ['client:w2', { before: 'm' }])).toBeDefined();
    expect(refuse('companion.older', ['conv:ws:w1', { before: 'm' }])).toBeDefined();
    expect(refuse('companion.older', ['home', { before: 'm' }])).toBeDefined();
  });

  it('only subscribes it to its own project’s conversations', () => {
    expect(topicInProject(state, 'shop', 'client')).toBe(true);
    expect(topicInProject(state, 'shop', 'client:w1')).toBe(true);
    // The Mac's views carry code, steps and files: a client never gets them, even for its own worktree.
    for (const t of ['conv:ws:w1', 'client:w2', 'client:old', 'conv:ws:w2', 'conv:room', 'home', 'work', 'plans', 'tasks', 'chat:dm:x', 'conv:mac:assistant']) expect(topicInProject(state, 'shop', t)).toBe(false);
  });
});
