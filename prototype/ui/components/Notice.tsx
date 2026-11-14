import type {ReactNode} from 'react';
import {Icon, type IconName} from './Icon';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const ICONS: Record<NoticeTone, IconName> = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  danger: 'bolt',
};

interface NoticeProps {
  tone: NoticeTone;
  title?: string | undefined;
  children: ReactNode;
  /** Кнопки дій під текстом. */
  actions?: ReactNode;
  /** alert — помилки, status — результати; без ролі — статичне пояснення. */
  role?: 'alert' | 'status' | undefined;
  className?: string | undefined;
}

/** Повідомлення з іконкою: пояснення, попередження чи результат. */
export function Notice({tone, title, children, actions, role, className}: NoticeProps) {
  const classes = ['notice', `notice--${tone}`, className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <Icon name={ICONS[tone]} />
      <div className="notice__body">
        <div role={role} aria-live={role === 'status' ? 'polite' : undefined}>
          {title && <p className="notice__title">{title}</p>}
          <div className="notice__text">{children}</div>
        </div>
        {actions && <div className="notice__actions">{actions}</div>}
      </div>
    </div>
  );
}
