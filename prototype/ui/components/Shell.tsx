import type {ReactNode} from 'react';
import {Banner} from './Banner';

interface ShellProps {
  header: ReactNode;
  nav: ReactNode;
  /** Закріплена зона відгуку на дії. */
  dock: ReactNode;
  busy: boolean;
  children: ReactNode;
}

/** Каркас застосунку: банер, шапка, навігація, основний зміст і підвал. */
export function Shell({header, nav, dock, busy, children}: ShellProps) {
  return (
    <>
      <a className="skip-link" href="#main">
        Перейти до змісту
      </a>
      <Banner />
      <div className="shell">
        {header}
        {nav}
        <main id="main" className="shell__main" tabIndex={-1} aria-busy={busy}>
          {children}
        </main>
        <footer className="shell__footer">
          <span>Кейс поранення · KSE MIL600</span>
          <span>Концепт на вигаданих даних. Без доступу до справжніх систем.</span>
        </footer>
      </div>
      {dock}
    </>
  );
}
