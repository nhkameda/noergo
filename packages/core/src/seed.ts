import type { Locale } from './db/types';

/**
 * The first board of a new account. It doubles as a short tour, so it is written in the
 * person's language and uses the features it describes ([[wikilinks]], tags, a to-do).
 */
export interface SeedContent {
  board: string;
  lanes: Array<{ title: string; inbox?: boolean; notes: Array<{ title: string; body?: string; tags?: string[] }> }>;
}

export const SEED: Record<Locale, SeedContent> = {
  'pt-BR': {
    board: 'Meus projetos',
    lanes: [
      {
        title: 'Entrada',
        inbox: true,
        notes: [
          { title: 'Bem-vindo ao noergo', body: 'Anote do jeito que pensa. Clique numa nota para abrir; arraste para reordenar ou mudar de pensamento.\n\nLigue uma ideia a outra escrevendo [[Mapa mental]].', tags: ['comece-aqui'] },
          { title: 'Capture rápido', body: 'A barra de captura joga tudo neste pensamento. Seus agentes também escrevem aqui.' },
        ],
      },
      {
        title: 'Fazendo',
        notes: [{ title: 'Mapa mental', body: 'Toque no ícone de mapa no topo de um pensamento: as mesmas notas viram um mapa mental que você conecta e arrasta.' }],
      },
      {
        title: 'Ideias',
        notes: [{ title: 'Conecte um agente', body: 'ChatGPT, Claude e Grok podem ler e organizar suas notas pelo MCP. Veja Configurações → Agentes.' }],
      },
    ],
  },
  en: {
    board: 'My projects',
    lanes: [
      {
        title: 'Inbox',
        inbox: true,
        notes: [
          { title: 'Welcome to noergo', body: 'Write the way you think. Click a note to open it; drag to reorder or move it to another thought.\n\nLink one idea to another by writing [[Mind map]].', tags: ['start-here'] },
          { title: 'Quick capture', body: 'The capture bar drops everything into this thought. Your agents write here too.' },
        ],
      },
      {
        title: 'Doing',
        notes: [{ title: 'Mind map', body: 'Press the map icon at the top of a thought: the same notes become a mind map you can connect and drag.' }],
      },
      {
        title: 'Ideas',
        notes: [{ title: 'Connect an agent', body: 'ChatGPT, Claude and Grok can read and organise your notes over MCP. See Settings → Agents.' }],
      },
    ],
  },
  'zh-CN': {
    board: '我的项目',
    lanes: [
      {
        title: '收件箱',
        inbox: true,
        notes: [
          { title: '欢迎使用 noergo', body: '按你的思路记录。点击笔记即可打开；拖动可以排序或移到别的想法。\n\n输入 [[思维导图]] 就能把两个想法连起来。', tags: ['从这里开始'] },
          { title: '快速记录', body: '快速记录栏会把内容放进这个想法。你的智能体也会写在这里。' },
        ],
      },
      {
        title: '进行中',
        notes: [{ title: '思维导图', body: '点击想法顶部的导图图标：同样的笔记会变成一张可以连线和拖动的思维导图。' }],
      },
      {
        title: '想法',
        notes: [{ title: '连接智能体', body: 'ChatGPT、Claude 和 Grok 可以通过 MCP 阅读和整理你的笔记。请前往 设置 → 智能体。' }],
      },
    ],
  },
};
