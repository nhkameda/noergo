/**
 * Hard limits. "Unlimited" boards and notes still need a technical ceiling so that one
 * account (or one runaway agent) cannot exhaust the database. Change only with a reason.
 */
export const LIMITS = {
  boardTitle: 200,
  laneTitle: 200,
  /** The database CHECK on lanes.description says the same. */
  laneDescription: 2000,
  noteTitle: 300,
  noteBody: 100_000,
  url: 2048,
  tags: 50,
  tagLength: 50,
  linkLabel: 200,
  notesPerWorkspace: 100_000,
  opsPerBatch: 50,
  notesPerCreateBatch: 50,
  /** Notes whose body is longer than this travel as an excerpt in snapshots. */
  snapshotBodyInline: 4_000,
  excerpt: 280,
  searchResults: 50,
  /** Ideas an agent reads of one thought at once (get_thought). */
  thoughtIdeas: 300,
  /** Calls one agent connection or token may make per minute. */
  agentCallsPerMinute: 120,
  fileBytes: 50 * 1024 * 1024,
  /** An image as sent (a screenshot), before it is decoded and re-encoded. */
  imageUploadBytes: 12 * 1024 * 1024,
  /** Decoding stops above this many pixels (decompression bombs). */
  imagePixels: 50_000_000,
  /** The long side of a stored image; a cover is drawn at most ~600 px wide. */
  imageSide: 1600,
  /** A stored image, after re-encoding (the database CHECK says the same). */
  imageStoredBytes: 2 * 1024 * 1024,
  /** How long the change log is kept: SSE resume window and activity feed. */
  changesResumeDays: 7,
  changesRetentionDays: 90,
  trashDays: 30,
  /** A new revision is cut when the actor changes or this much time has passed. */
  revisionCoalesceMs: 10 * 60 * 1000,
} as const;

export const COLORS = [
  '#ffc21a', // faísca
  '#ff8a26', // tangerina
  '#e8483a', // urucum
  '#ff5a8a', // goiaba
  '#3366ff', // anil
  '#17b3d1', // lagoa
  '#1fbf6e', // broto
  '#142b45', // azul profundo
] as const;

/**
 * The colours a mind map's main branches take in turn when they have none of their own,
 * far apart on the wheel so neighbours differ. The thought's own colour is left out.
 */
export const BRANCH_COLORS = [COLORS[4], COLORS[1], COLORS[6], COLORS[3], COLORS[5], COLORS[0], COLORS[2]] as const;

/** The colour of the `index`th main branch (column order) of a thought coloured `thought`. */
export function branchColor(index: number, thought: string | null): string {
  const list = BRANCH_COLORS.filter((c) => c !== thought);
  return list[index % list.length]!;
}

/**
 * How a thought's mind map is laid out: from its tree, on both sides of the centre, to one
 * side or downward, re-laid as ideas come, go and fold; or 'free', each idea where it was put.
 * Positions stored while a tree layout is on are not read; they are where 'free' starts.
 */
export const MAP_LAYOUTS = ['balanced', 'right', 'left', 'down', 'free'] as const;
export type MapLayout = (typeof MAP_LAYOUTS)[number];
