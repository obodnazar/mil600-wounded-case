const LINKS: readonly {href: string; label: string}[] = [
  {href: '#facts', label: 'Підтверджено'},
  {href: '#deadlines', label: 'Строки'},
  {href: '#documents', label: 'Документи'},
  {href: '#finance', label: 'Виплати'},
  {href: '#timeline', label: 'Події'},
  {href: '#help', label: 'Допомога'},
];

/** Швидкі переходи до розділів кейсу: довга сторінка без нескінченного скролу. */
export function SectionNav() {
  return (
    <nav className="section-nav" aria-label="Розділи кейсу">
      <ul>
        {LINKS.map(link => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
