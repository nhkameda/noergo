import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { branchColor, COLORS, createApiToken, principalFromToken, setFocus, type AgentPrincipal } from '@noergo/core';
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

type Placed = { id: string; title: string; parent: string | null; level: number; color: string | null; collapsed: boolean };
type Thought = { thought: { color: string | null; map_layout: string }; ideas: Placed[] };
/** A thought as get_thought tells it, and its tree drawn as an outline of titles. */
async function readThought(call: Awaited<ReturnType<typeof connect>>['call'], id: string) {
  const t = (await call('get_thought', { thought_id: id })).structuredContent as Thought;
  return { ...t, outline: t.ideas.map((i) => `${'  '.repeat(i.level - 1)}${i.title}`) };
}
const idsOf = (r: Result) => (r.structuredContent as { ideas: Array<{ id: string }> }).ideas.map((i) => i.id);

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
        "organize_map",
        "place_ideas",
        "search",
        "update_board",
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
      ['update_board', { board_id: theirBoard, title: 'mine now', icon: '🏴‍☠️' }],
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

  it('a read-only connection reads but never writes; an account not enabled gets agents_not_enabled', async () => {
    const ro = await agentFor(true);
    const [lane] = await lanesOf(ro.workspaceId);
    const reader = await connect(ro.principal);
    expect((await reader.call('list_boards')).isError).toBeFalsy();
    expect(errorCode(await reader.call('add_notes', { thought_id: lane!.id, ideas: [{ title: 'x' }] }))).toBe('read_only_connection');
    expect(errorCode(await reader.call('create_board', { title: 'x' }))).toBe('read_only_connection');
    await reader.close();

    const off = await agentFor();
    const locked = await connect(off.principal, false);
    expect(errorCode(await locked.call('list_boards'))).toBe('agents_not_enabled');
    expect(errorCode(await locked.call('search', { query: 'x' }))).toBe('agents_not_enabled');
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

  it('gives a thought its website, read back everywhere, and refuses one a click could run', async () => {
    const a = await agentFor();
    const [lane] = await lanesOf(a.workspaceId);
    const { call, close } = await connect(a.principal);
    expect((await call('update_thought', { thought_id: lane!.id, url: 'https://noergo.com/' })).isError).toBeFalsy();
    const read = (await call('get_thought', { thought_id: lane!.id })).structuredContent as { thought: { url: string | null } };
    expect(read.thought.url).toBe('https://noergo.com/');
    const listed = (await call('list_boards')).structuredContent as { boards: Array<{ thoughts: Array<{ id: string; url: string | null }> }> };
    expect(listed.boards.flatMap((b) => b.thoughts).find((t) => t.id === lane!.id)?.url).toBe('https://noergo.com/');
    expect(errorCode(await call('update_thought', { thought_id: lane!.id, url: 'javascript:alert(1)' }))).toBe('invalid');
    const made = (await call('create_thought', { title: 'Example', url: 'https://example.com/' })).structuredContent as { thought_id: string };
    expect(((await call('get_thought', { thought_id: made.thought_id })).structuredContent as { thought: { url: string } }).thought.url).toBe('https://example.com/');
    expect((await call('update_thought', { thought_id: lane!.id, url: null })).isError).toBeFalsy();
    expect(((await call('get_thought', { thought_id: lane!.id })).structuredContent as { thought: { url: string | null } }).thought.url).toBeNull();
    await close();
  });

  it('describes a thought, and reads the description back in get_thought, list_boards and fetch', async () => {
    const a = await agentFor();
    const [lane] = await lanesOf(a.workspaceId);
    const { call, close } = await connect(a.principal);
    expect((await call('update_thought', { thought_id: lane!.id, description: '  Clients we call this week  ' })).isError).toBeFalsy();
    const read = (await call('get_thought', { thought_id: lane!.id })).structuredContent as { thought: { description: string } };
    expect(read.thought.description).toBe('Clients we call this week');
    const listed = (await call('list_boards')).structuredContent as { boards: Array<{ thoughts: Array<{ id: string; description: string }> }> };
    expect(listed.boards.flatMap((b) => b.thoughts).find((t) => t.id === lane!.id)?.description).toBe('Clients we call this week');
    const fetched = (await call('fetch', { id: lane!.id })).structuredContent as { text: string };
    expect(fetched.text).toContain('Clients we call this week');
    const made = (await call('create_thought', { title: 'Trips', description: 'Where we go in 2027' })).structuredContent as { thought_id: string };
    expect(((await call('get_thought', { thought_id: made.thought_id })).structuredContent as { thought: { description: string } }).thought.description).toBe('Where we go in 2027');
    expect((await call('update_thought', { thought_id: lane!.id, description: '' })).isError).toBeFalsy();
    expect(((await call('get_thought', { thought_id: lane!.id })).structuredContent as { thought: { description: string } }).thought.description).toBe('');
    await close();
  });

  it('folds a branch, shows it in get_thought and the outline, whatever lines cross it', async () => {
    const a = await agentFor();
    const [lane] = await lanesOf(a.workspaceId);
    const { call, close } = await connect(a.principal);
    const r = await call('add_notes', { thought_id: lane!.id, ideas: [{ ref: 'case', title: 'Aluminium case' }, { title: 'Extrusion', parent: 'case' }, { title: 'CNC', parent: 'case' }, { title: 'Anodising', parent: 'case' }] });
    const [kase, , cnc] = (r.structuredContent as { ideas: Array<{ id: string }> }).ideas;

    expect((await call('update_note', { note_id: kase!.id, collapsed: true })).isError).toBeFalsy();
    const read = (await call('get_thought', { thought_id: lane!.id })).structuredContent as { ideas: Array<{ id: string; collapsed: boolean }> };
    expect(read.ideas.find((i) => i.id === kase!.id)?.collapsed).toBe(true);
    const outline = ((await call('fetch', { id: lane!.id })).structuredContent as { text: string }).text;
    expect(outline).toContain('- Aluminium case (folded: 3 hidden below)');
    expect(outline).toContain('\n  - CNC');

    // Nothing below: nothing to fold. A line from another idea into the branch neither stops the fold nor widens the other's.
    expect(errorCode(await call('update_note', { note_id: cnc!.id, collapsed: true }))).toBe('invalid');
    expect((await call('update_note', { note_id: kase!.id, collapsed: false })).isError).toBeFalsy();
    const other = ((await call('add_notes', { thought_id: lane!.id, ideas: [{ title: 'Suppliers' }] })).structuredContent as { ideas: Array<{ id: string }> }).ideas[0]!;
    expect((await call('connect_notes', { from_id: other.id, to_id: cnc!.id })).isError).toBeFalsy();
    expect((await call('update_note', { note_id: kase!.id, collapsed: true })).isError).toBeFalsy();
    expect(((await call('fetch', { id: lane!.id })).structuredContent as { text: string }).text).toContain('- Aluminium case (folded: 3 hidden below)');
    expect(errorCode(await call('update_note', { note_id: other.id, collapsed: true }))).toBe('invalid');
    await close();
  });

  it('lays a map out from its tree, one colour per main branch, and shows the levels asked for', async () => {
    const a = await agentFor();
    const { call, close } = await connect(a.principal);
    const laneId = ((await call('create_thought', { title: 'Trip', color: 'red' })).structuredContent as { thought_id: string }).thought_id;
    const [coast, paraty] = idsOf(await call('add_notes', { thought_id: laneId, ideas: [{ ref: 'c', title: 'Coast' }, { ref: 'p', title: 'Paraty', parent: 'c' }, { title: 'Dock', parent: 'p' }, { ref: 'b', title: 'Budget', color: 'teal' }, { title: 'Fuel', parent: 'b', color: 'red' }] }));

    let t = await readThought(call, laneId);
    expect(t.thought.map_layout).toBe('balanced');
    expect(t.outline).toEqual(['Coast', '  Paraty', '    Dock', 'Budget', '  Fuel']);
    expect(t.ideas.map((i) => i.parent)).toEqual(['root', coast, paraty, 'root', t.ideas[3]!.id]);

    const r = await call('organize_map', { thought_id: laneId, layout: 'down', colors: 'by_branch', show_levels: 1 });
    expect(r.structuredContent).toEqual({ thought_id: laneId, map_layout: 'down', recoloured: 3, folded: 2, opened: 0 });
    t = await readThought(call, laneId);
    expect(t.thought.map_layout).toBe('down');
    // Each main branch its own colour, never the thought's; the ideas below follow theirs.
    const red = t.thought.color;
    expect(t.ideas.map((i) => i.color)).toEqual([branchColor(0, red), null, null, branchColor(1, red), null]);
    expect(t.ideas.map((i) => i.collapsed)).toEqual([true, false, false, true, false]);

    expect((await call('organize_map', { thought_id: laneId, show_levels: null })).structuredContent).toMatchObject({ folded: 0, opened: 2 });
    expect(errorCode(await call('organize_map', { thought_id: laneId }))).toBe('invalid');
    // Free is a person's hand on the map; an agent lays it out from its tree.
    expect((await call('organize_map', { thought_id: laneId, layout: 'free' })).isError).toBe(true);
    await close();
  });

  it('rearranges ideas in their tree all at once or not at all, and what hangs from one goes along', async () => {
    const a = await agentFor();
    const { call, close } = await connect(a.principal);
    const laneId = ((await call('create_thought', { title: 'Launch' })).structuredContent as { thought_id: string }).thought_id;
    const [press, , blog, , shop, stock] = idsOf(await call('add_notes', { thought_id: laneId, ideas: [{ ref: 'p', title: 'Press' }, { ref: 'k', title: 'Kit', parent: 'p' }, { ref: 'g', title: 'Blog', parent: 'p' }, { title: 'Draft', parent: 'g' }, { ref: 's', title: 'Shop' }, { title: 'Stock', parent: 's' }] }));
    const outline = async () => (await readThought(call, laneId)).outline;
    expect(await outline()).toEqual(['Press', '  Kit', '  Blog', '    Draft', 'Shop', '  Stock']);

    const r = await call('place_ideas', {
      moves: [
        { note_id: blog, before_id: (await readThought(call, laneId)).ideas[1]!.id },
        { note_id: blog, parent: shop, after_id: stock },
        { note_id: shop, parent: 'root', before_id: press },
      ],
    });
    expect(r.structuredContent).toEqual({ thought_id: laneId, moved: 3 });
    expect(await outline()).toEqual(['Shop', '  Stock', '  Blog', '    Draft', 'Press', '  Kit']);

    // Under an idea below itself: the whole batch is refused, the first move too.
    const loop = await call('place_ideas', { moves: [{ note_id: press, before_id: shop }, { note_id: shop, parent: blog }] });
    expect(errorCode(loop)).toBe('invalid');
    expect(await outline()).toEqual(['Shop', '  Stock', '  Blog', '    Draft', 'Press', '  Kit']);
    expect(errorCode(await call('place_ideas', { moves: [{ note_id: stock, before_id: press }] }))).toBe('invalid');

    // Linked from two ideas above it, it changes order but not parent.
    expect((await call('connect_notes', { from_id: press, to_id: blog })).isError).toBeFalsy();
    const twice = await call('place_ideas', { moves: [{ note_id: blog, parent: press }] });
    expect(errorCode(twice)).toBe('invalid');
    expect(JSON.stringify(twice.content)).toContain('Blog');
    expect((await call('place_ideas', { moves: [{ note_id: blog, before_id: stock }] })).isError).toBeFalsy();
    expect(await outline()).toEqual(['Shop', '  Blog', '    Draft', '  Stock', 'Press', '  Kit']);

    // An idea of another thought is not in this one.
    const [elsewhere] = idsOf(await call('add_notes', { thought_id: (await lanesOf(a.workspaceId))[0]!.id, ideas: [{ title: 'Elsewhere' }] }));
    expect(errorCode(await call('place_ideas', { moves: [{ note_id: press, before_id: shop }, { note_id: elsewhere, parent: shop }] }))).toBe('not_found');
    expect(await outline()).toEqual(['Shop', '  Blog', '    Draft', '  Stock', 'Press', '  Kit']);
    await close();
  });

  it('hangs an idea linked the wrong way under its parent by turning that link round, and the parent then folds', async () => {
    const a = await agentFor();
    const { call, close } = await connect(a.principal);
    const laneId = ((await call('create_thought', { title: 'Shop' })).structuredContent as { thought_id: string }).thought_id;
    const [stock, bins] = idsOf(await call('add_notes', { thought_id: laneId, ideas: [{ title: 'Stock' }, { title: 'Bins', parent: 'root' }] }));
    // Drawn from the sub-idea to its parent: a line, no branch.
    expect((await call('connect_notes', { from_id: bins, to_id: stock })).isError).toBeFalsy();
    expect(errorCode(await call('update_note', { note_id: stock, collapsed: true }))).toBe('invalid');

    expect((await call('place_ideas', { moves: [{ note_id: bins, parent: stock }] })).isError).toBeFalsy();
    const t = await readThought(call, laneId);
    expect(t.outline).toEqual(['Stock', '  Bins']);
    expect(t.ideas[1]!.parent).toBe(stock);
    expect((await call('update_note', { note_id: stock, collapsed: true })).isError).toBeFalsy();
    await close();
  });

  it('runs every write through the op schema the web uses: trimmed titles, well-formed websites', async () => {
    const a = await agentFor();
    const [lane] = await lanesOf(a.workspaceId);
    const { call, close } = await connect(a.principal);
    expect((await call('update_thought', { thought_id: lane!.id, title: '  Clients  ' })).isError).toBeFalsy();
    const row = await pools().jobs.selectFrom('lanes').select('title').where('id', '=', lane!.id).executeTakeFirstOrThrow();
    expect(row.title).toBe('Clients');
    const r = await call('update_thought', { thought_id: lane!.id, url: 'https://exa mple.com' });
    expect(errorCode(r)).toBe('invalid');
    await close();
  });

  it('gives a board an icon and colours, read back in list_boards, and refuses an icon that is not one emoji', async () => {
    const a = await agentFor();
    const { call, close } = await connect(a.principal);
    const made = (await call('create_board', { title: 'Garden', icon: '🌱', color: 'green', background: '#fff3bf' })).structuredContent as { board_id: string };
    type Listed = { boards: Array<{ id: string; icon: string | null; color: string | null; background: string | null }> };
    const garden = () => call('list_boards').then((r) => (r.structuredContent as Listed).boards.find((b) => b.id === made.board_id));
    expect(await garden()).toMatchObject({ icon: '🌱', color: COLORS[6], background: '#fff3bf' });
    expect((await call('update_board', { board_id: made.board_id, icon: 'leaf', background: null })).isError).toBeFalsy();
    expect(await garden()).toMatchObject({ icon: 'leaf', color: COLORS[6], background: null });
    for (const icon of ['🌱🌱', 'Garden', '<b>', '❤']) expect(errorCode(await call('update_board', { board_id: made.board_id, icon })), icon).toBe('invalid');
    expect(errorCode(await call('update_board', { board_id: made.board_id }))).toBe('invalid');
    expect((await garden())?.icon).toBe('leaf');
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

