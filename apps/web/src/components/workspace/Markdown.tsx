'use client';

import { useTranslations } from 'next-intl';
import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * A note body as HTML. Notes are written by agents too, so the body is untrusted:
 *
 * - raw HTML is dropped (skipHtml), never rendered;
 * - links keep react-markdown's protocol filter (no javascript:, data:) and open apart,
 *   without referrer;
 * - images are not loaded: an external image URL would tell its server who read the note
 *   (the CSP blocks them too). They show as a link.
 *
 * [[Title]] and [[Title|alias]] become buttons that open the note, as in the editor's links.
 */
const WIKILINK = /\[\[([^[\]\n|]{1,300})(?:\|([^[\]\n]{0,300}))?\]\]/g;
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/;
const NOTE_HREF = '#nr-note=';

function withWikilinks(body: string): string {
  return body
    .split(CODE)
    .map((part, i) => (i % 2 ? part : part.replace(WIKILINK, (_, target: string, alias?: string) => `[${(alias?.trim() || target.trim()).replace(/[\\*_`]/g, '\\$&')}](<${NOTE_HREF}${encodeURIComponent(target.trim())}>)`)))
    .join('');
}

export const Markdown = memo(function Markdown({ text, onWikilink }: { text: string; onWikilink: (target: string) => void }) {
  const t = useTranslations('app');
  return (
    <div className="w-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith(NOTE_HREF)) {
              const target = decodeURIComponent(href.slice(NOTE_HREF.length));
              return (
                <button type="button" className="w-wikilink" onClick={() => onWikilink(target)}>
                  {children}
                </button>
              );
            }
            if (!href) return <span>{children}</span>;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
                {children}
              </a>
            );
          },
          img: ({ src, alt }) =>
            typeof src === 'string' && src ? (
              <a href={src} target="_blank" rel="noopener noreferrer nofollow ugc" className="w-md__img">
                {t('note.image', { alt: alt || src })}
              </a>
            ) : null,
        }}
      >
        {withWikilinks(text)}
      </ReactMarkdown>
    </div>
  );
});
