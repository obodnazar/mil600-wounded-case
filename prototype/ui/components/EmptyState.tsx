import type {ReactNode} from 'react';
import {Icon, type IconName} from './Icon';

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

/** Порожній результат: пояснює, чому тут нічого немає і що з цим робити. */
export function EmptyState({icon = 'info', title, children, action}: EmptyStateProps) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size={24} />
      </span>
      <p className="empty__title">{title}</p>
      {children && <p className="empty__text">{children}</p>}
      {action}
    </div>
  );
}
