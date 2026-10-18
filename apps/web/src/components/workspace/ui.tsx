'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ReactNode } from 'react';
import { isComposing } from './context';
import { IconMore } from './icons';
import { colorName, PALETTE } from './model';

/**
 * A menu in the browser's top layer (the Popover API): Esc and a click outside close it,
 * and focus returns to the button by itself.
 */
export function Menu({ label, children, icon = <IconMore />, className = 'w-icon-btn' }: { label: string; children: (close: () => void) => ReactNode; icon?: ReactNode; className?: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const place = () =>
    requestAnimationFrame(() => {
      const b = button.current?.getBoundingClientRect();
      const p = panel.current;
      if (!b || !p) return;
      const width = p.offsetWidth;
      const height = p.offsetHeight;
      p.style.left = `${Math.max(8, Math.min(b.right - width, window.innerWidth - width - 8))}px`;
      p.style.top = `${b.bottom + height + 8 > window.innerHeight ? Math.max(8, b.top - height - 4) : b.bottom + 4}px`;
      p.querySelector<HTMLElement>('button, input, select, a')?.focus();
    });
  return (
    <>
      <button ref={button} type="button" className={className} aria-label={label} title={label} popoverTarget={id} aria-haspopup="true" onClick={place}>
        {icon}
      </button>
      <div ref={panel} id={id} popover="auto" className="w-menu" role="group" aria-label={label}>
        {children(() => document.getElementById(id)?.hidePopover())}
      </div>
    </>
  );
}

/** The content colours as a radio group; "none" first. */
export function Swatches({ value, onChange, label }: { value: string | null; onChange: (hex: string | null) => void; label: string }) {
  const t = useTranslations('app');
  const current = colorName(value) ?? null;
  return (
    <div className="w-swatches" role="radiogroup" aria-label={label}>
      <button type="button" role="radio" aria-checked={current === null} className="w-swatch w-swatch--none" aria-label={t('noColor')} title={t('noColor')} onClick={() => onChange(null)} />
      {PALETTE.map((c) => (
        <button key={c.name} type="button" role="radio" aria-checked={current === c.name} className="w-swatch" data-cor={c.name} aria-label={t(`colors.${c.name}`)} title={t(`colors.${c.name}`)} onClick={() => onChange(c.hex)} />
      ))}
    </div>
  );
}

/**
 * A text that turns into a field: Enter saves, Esc gives up, leaving the field saves.
 * Used to rename boards and columns and to create them.
 */
export function InlineEdit({
  value,
  onSave,
  onCancel,
  label,
  placeholder,
  maxLength,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
  label: string;
  placeholder?: string;
  maxLength: number;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = text.trim();
    if (save && v && v !== value) onSave(v);
    else onCancel();
  };
  return (
    <input
      className={className ?? 'w-inline-input'}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      maxLength={maxLength}
      autoFocus
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isComposing(e)) {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}
