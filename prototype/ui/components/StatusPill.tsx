import type {ReactNode} from 'react';
import type {Tone} from '../content/labels';
import {Icon, type IconName} from './Icon';

const TONE_ICONS: Record<Tone, IconName> = {
  confirmed: 'check',
  pending: 'clock',
  unknown: 'question',
  attention: 'alert',
  conflict: 'bolt',
  neutral: 'minus',
};

interface StatusPillProps {
  tone: Tone;
  children: ReactNode;
}

/** Позначка стану: колір, іконка й текст разом — стан не передається лише кольором. */
export function StatusPill({tone, children}: StatusPillProps) {
  return (
    <span className={`pill pill--${tone}`}>
      <Icon name={TONE_ICONS[tone]} size={16} />
      <span>{children}</span>
    </span>
  );
}

interface TagProps {
  children: ReactNode;
  accent?: boolean;
}

/** Нейтральна мітка без стану (категорія, ідентифікатор показника). */
export function Tag({children, accent = false}: TagProps) {
  return <span className={accent ? 'tag tag--accent' : 'tag'}>{children}</span>;
}
