import {useEffect, useState, type ReactNode} from 'react';
import {useMediaQuery} from '../lib/hooks';
import {Icon} from './Icon';

interface SectionProps {
  id: string;
  eyebrow: string;
  title: string;
  /** Короткий підзаголовок-пояснення. */
  lead?: ReactNode;
  /** На телефоні розділ згортається до заголовка, щоб сторінка не була нескінченною. */
  collapsible?: boolean;
  /** Чи розгорнутий згортуваний розділ одразу. */
  defaultOpen?: boolean;
  /** Стислий підсумок у згорнутому заголовку (наприклад, «41 подія»). */
  summary?: string | undefined;
  children: ReactNode;
}

/** Розгортає розділ, коли на нього веде якір (#id) — із адреси або з посилання на сторінці. */
function useAnchorOpen(id: string, initial: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(initial || window.location.hash === `#${id}`);
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(`a[href="#${id}"]`)) setOpen(true);
    };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onClick);
    };
  }, [id]);
  return [open, setOpen];
}

/** Розділ сторінки з підписом, заголовком h2 і якорем для переходу. */
export function Section(props: SectionProps) {
  const {id, eyebrow, title, lead, collapsible = false, defaultOpen = false, summary, children} = props;
  const narrow = useMediaQuery('(max-width: 719px)');
  const [open, setOpen] = useAnchorOpen(id, defaultOpen);
  const titleId = `${id}-title`;

  if (!collapsible || !narrow) {
    return (
      <section className="section" id={id} aria-labelledby={titleId}>
        <header className="section__head">
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={titleId}>{title}</h2>
          {lead && <p className="section__lead">{lead}</p>}
        </header>
        {children}
      </section>
    );
  }

  return (
    <section className="section section--collapsible" id={id} aria-labelledby={titleId}>
      <h2 id={titleId} className="section__toggle">
        <button type="button" aria-expanded={open} aria-controls={`${id}-content`} onClick={() => setOpen(!open)}>
          <span className="section__toggle-text">
            <span className="eyebrow">{eyebrow}</span>
            <span className="section__toggle-title">{title}</span>
            {summary && !open && <span className="section__toggle-summary">{summary}</span>}
          </span>
          <Icon name="chevron" size={24} />
        </button>
      </h2>
      <div id={`${id}-content`} className="section__content" hidden={!open}>
        {lead && <p className="section__lead">{lead}</p>}
        {children}
      </div>
    </section>
  );
}
