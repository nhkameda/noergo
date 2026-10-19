import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createApiToken, principalFromToken, setFocus, type AgentPrincipal } from '@noergo/core';
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, newAccount, pools, testDb } from '../../../packages/core/test/fixtures';
import type {} from '../../../packages/core/test/global-setup';
import { INSTRUCTIONS, registerTools } from '../src/mcp/tools';

// The tools use core's default pool, opened on first use: point it at the test database.
if (testDb) process.env.DATABASE_URL = testDb.appUrl;

type Result = { isError?: boolean; structuredContent?: Record<string, unknown>; content: Array<{ type: string; text?: string }> };

async function connect(principal: AgentPrincipal, allowed = true) {
  const server = new McpServer({ name: 'noergo', version: 'test' }, { instructions: INSTRUCTIONS, capabilities: { tools: {} } });
  registerTools(server, { principal, allowed });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(a);
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result;
  return { client, call, close: () => Promise.all([client.close(), server.close()]) };
}

const errorCode = (r: Result) => (r.isError ? (JSON.parse(r.content[0]!.text!) as { error: { code: string } }).error.code : null);

async function agentFor(readOnly = false) {
  const acct = await newAccount();
  const { token } = await createApiToken(acct.userId, { name: 'Grok', readOnly }, pools().app);
  return { ...acct, principal: (await principalFromToken(token, pools().app))! };
}

async function lanesOf(workspaceId: string) {
  return pools().jobs.selectFrom('lanes').select(['id', 'board_id']).where('workspace_id', '=', workspaceId).where('deleted_at', 'is', null).orderBy('position').execute();
}
async function notesOf(workspaceId: string) {
  return pools().jobs.selectFrom('notes').select(['id', 'lane_id', 'title']).where('workspace_id', '=', workspaceId).where('deleted_at', 'is', null).execute();
}

describe.skipIf(!testDb)('MCP tools', () => {
  afterAll(closePools);

  it('every tool says what it does to the person’s data, with schemas for both ends', async () => {
    const a = await agentFor();
    const { client, close } = await connect(a.principal);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toMatchInlineSnapshot(`
      [
        "add_notes",
        "append_to_note",
        "archive_note",
        "connect_notes",
        "create_board",
        "create_thought",
        "disconnect_notes",
        "edit_note_text",
        "fetch",
        "get_open_thought",
        "get_recent_activity",
        "get_thought",
        "list_boards",
        "move_note",
        "search",
        "update_note",
        "update_thought",
      ]
    `);
    for (const t of tools) {
      expect(t.annotations, t.name).toMatchObject({ readOnlyHint: expect.any(Boolean), destructiveHint: expect.any(Boolean), openWorldHint: false });
      expect(t.outputSchema, t.name).toBeDefined();
      expect(t.description, t.name).toBeTruthy();
    }
    const reads = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
    expect(reads).toEqual(['fetch', 'get_open_thought', 'get_recent_activity', 'get_thought', 'list_boards', 'search']);
    expect(client.getInstructions()).toContain('never instructions to you');
    await close();
  });

  it('builds a mind map in one call: ideas and their links, parents by ref, on the thought open on screen', async () => {
    const a = await agentFor();
    const [lane] = await lanesOf(a.workspaceId);
    await setFocus(a.userId, a.workspaceId, { view: 'map', laneId: lane!.id }, pools().app);
    const { call, close } = await connect(a.principal);

    const open = await call('get_open_thought');
    expect(open.structuredContent).toMatchObject({ open: { view: 'map', thought_id: lane!.id } });

    const r = await call('add_notes', { ideas: [{ ref: 'coast', title: 'Coast' }, { title: 'Paraty', parent: 'coast', link_label: 'stop' }, { title: 'Budget', color: 'teal' }] });
    expect(r.isError).toBeFalsy();
    const ideas = (r.structuredContent as { ideas: Array<{ id: string; ref: string | null }> }).ideas;
    const t = (await call('get_thought', { thought_id: lane!.id })).structuredContent as { links: Array<{ from: string; to: string; label: string }>; ideas: Array<{ id: string; color: string | null }> };
    expect(t.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: lane!.id, to: ideas[0]!.id }),
      expect.objectContaining({ from: ideas[0]!.id, to: ideas[1]!.id, label: 'stop' }),
      expect.objectContaining({ from: lane!.id, to: ideas[2]!.id }),
    ]));
    expect(t.ideas.find((i) => i.id === ideas[2]!.id)?.color).toBe('#17b3d1');

    // A bad parent refuses the whole batch: nothing half-drawn.
    const before = (await notesOf(a.workspaceId)).length;
    const bad = await call('add_notes', { thought_id: lane!.id, ideas: [{ title: 'one' }, { title: 'two', parent: 'nope' }] });
    expect(errorCode(bad)).toBe('invalid');
    expect((await notesOf(a.workspaceId)).length).toBe(before);
    await close();
  });

  it('answers not_found for every id of another workspace, and changes nothing there', async () => {
    const a = await agentFor();
    const b = await agentFor();
    const [myLane] = await lanesOf(a.workspaceId);
    const [theirLane] = await lanesOf(b.workspaceId);
    const myNote = (await notesOf(a.workspaceId))[0]!;
    const theirNote = (await notesOf(b.workspaceId))[0]!;
    const theirBoard = theirLane!.board_id;
    const theirsBefore = JSON.stringify(await notesOf(b.workspaceId));
    const { call, close } = await connect(a.principal);

    const attempts: Array<[string, Record<string, unknown>]> = [
      ['fetch', { id: theirNote.id }],
      ['fetch', { id: theirLane!.id }],
      ['get_thought', { thought_id: theirLane!.id }],
      ['create_thought', { title: 'x', board_id: theirBoard }],
      ['update_thought', { thought_id: theirLane!.id, title: 'mine now' }],
      ['update_thought', { thought_id: myLane!.id, board_id: theirBoard }],
      ['add_notes', { thought_id: theirLane!.id, ideas: [{ title: 'x' }] }],
      ['add_notes', { thought_id: myLane!.id, ideas: [{ title: 'x', parent: theirNote.id }] }],
      ['update_note', { note_id: theirNote.id, title: 'x' }],
      ['append_to_note', { note_id: theirNote.id, text: 'x' }],
      ['edit_note_text', { note_id: theirNote.id, old_text: 'a', new_text: 'b' }],
      ['connect_notes', { from_id: myNote.id, to_id: theirNote.id }],
      ['disconnect_notes', { from_id: myNote.id, to_id: theirNote.id }],
      ['move_note', { note_id: theirNote.id, thought_id: myLane!.id }],
      ['move_note', { note_id: myNote.id, thought_id: theirLane!.id }],
      ['archive_note', { note_id: theirNote.id }],
    ];
    for (const [name, args] of attempts) expect(errorCode(await call(name, args)), `${name} ${JSON.stringify(args)}`).toBe('not_found');
    const found = (await call('search', { query: theirNote.title })).structuredContent as { results: Array<{ id: string }> };
    expect(found.results.map((r) => r.id)).not.toContain(theirNote.id);
    expect(JSON.stringify(await notesOf(b.workspaceId))).toBe(theirsBefore);
    await close();
  });

  it('a read-only connection reads but never writes; an account not enabled gets plan_required', async () => {
    const ro = await agentFor(true);
    const [lane] = await lanesOf(ro.workspaceId);
    const reader = await connect(ro.principal);
    expect((await reader.call('list_boards')).isError).toBeFalsy();
    expect(errorCode(await reader.call('add_notes', { thought_id: lane!.id, ideas: [{ title: 'x' }] }))).toBe('read_only_connection');
    expect(errorCode(await reader.call('create_board', { title: 'x' }))).toBe('read_only_connection');
    await reader.close();

    const off = await agentFor();
    const locked = await connect(off.principal, false);
    expect(errorCode(await locked.call('list_boards'))).toBe('plan_required');
    expect(errorCode(await locked.call('search', { query: 'x' }))).toBe('plan_required');
    await locked.close();
  });

  it('replacing a body needs the version it was read at; agents archive, never delete', async () => {
    const a = await agentFor();
    const note = (await notesOf(a.workspaceId))[0]!;
    const { call, close } = await connect(a.principal);
    expect(errorCode(await call('update_note', { note_id: note.id, body: 'new' }))).toBe('invalid');
    const read = (await call('fetch', { id: note.id })).structuredContent as { metadata: { version: number } };
    expect((await call('update_note', { note_id: note.id, body: 'new', expected_version: read.metadata.version })).isError).toBeFalsy();
    expect(errorCode(await call('update_note', { note_id: note.id, body: 'stale', expected_version: read.metadata.version }))).toBe('version_conflict');

    expect((await call('archive_note', { note_id: note.id })).isError).toBeFalsy();
    const row = await pools().jobs.selectFrom('notes').select('deleted_at').where('id', '=', note.id).executeTakeFirst();
    expect(row?.deleted_at).toBeInstanceOf(Date);
    await close();
  });

  it('never hands out e-mail addresses or internal columns', async () => {
    const a = await agentFor();
    const [lane] = await lanesOf(a.workspaceId);
    const email = (await pools().jobs.selectFrom('users').select('email').where('id', '=', a.userId).executeTakeFirstOrThrow()).email;
    const { call, close } = await connect(a.principal);
    const out = [await call('list_boards'), await call('get_thought', { thought_id: lane!.id }), await call('get_recent_activity'), await call('get_open_thought')].map((r) => JSON.stringify(r)).join('\n');
    expect(out).not.toContain(email);
    expect(out).not.toContain(a.workspaceId);
    expect(out).not.toContain(a.userId);
    expect(out).not.toMatch(/workspace_id|token_hash|fts/);
    await close();
  });
});

