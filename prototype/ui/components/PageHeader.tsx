import type {ReactNode} from 'react';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  lead?: string;
  /** Додаткові елементи праворуч від заголовка (перемикач, позначки). */
  aside?: ReactNode;
}

/** Заголовок екрана: єдиний h1 на сторінці. */
export function PageHeader({eyebrow, title, lead, aside}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lead && <p className="page-header__lead">{lead}</p>}
      </div>
      {aside && <div className="page-header__aside">{aside}</div>}
    </header>
  );
}
