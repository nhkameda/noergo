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
