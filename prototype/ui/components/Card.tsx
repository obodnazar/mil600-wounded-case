import type {ReactNode} from 'react';

type Surface = 'paper' | 'olive' | 'dark' | 'outline';

interface CardProps {
  surface?: Surface;
  as?: 'section' | 'article' | 'div' | 'aside';
  className?: string | undefined;
  labelledBy?: string | undefined;
  children: ReactNode;
}

/** Поверхня-контейнер. paper — основний зміст, olive — підсумок, dark/outline — пояснення. */
export function Card({surface = 'paper', as: Element = 'div', className, labelledBy, children}: CardProps) {
  const classes = ['card', `card--${surface}`, className ?? ''].filter(Boolean).join(' ');
  return (
    <Element className={classes} aria-labelledby={labelledBy}>
      {children}
    </Element>
  );
}
