import type {ButtonHTMLAttributes, ReactNode} from 'react';
import {Icon, type IconName} from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName | undefined;
  trailingIcon?: IconName | undefined;
  /** Розтягнути на всю ширину контейнера. */
  block?: boolean;
  children: ReactNode;
}

/** Єдина кнопка інтерфейсу: завжди type="button", висота не менша за 44px. */
export function Button({variant = 'secondary', icon, trailingIcon, block, className, children, ...rest}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, block ? 'btn--block' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} {...rest}>
      {icon && <Icon name={icon} />}
      <span className="btn__label">{children}</span>
      {trailingIcon && <Icon name={trailingIcon} />}
    </button>
  );
}
