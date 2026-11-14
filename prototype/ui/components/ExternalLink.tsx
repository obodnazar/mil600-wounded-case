import type {ReactNode} from 'react';
import {Icon} from './Icon';

interface ExternalLinkProps {
  href: string;
  children: ReactNode;
}

/** Зовнішнє посилання в новій вкладці з явною позначкою. */
export function ExternalLink({href, children}: ExternalLinkProps) {
  return (
    <a className="external-link" href={href} target="_blank" rel="noreferrer">
      <span>{children}</span>
      <Icon name="external" size={16} />
      <span className="visually-hidden"> (відкриється в новій вкладці)</span>
    </a>
  );
}
