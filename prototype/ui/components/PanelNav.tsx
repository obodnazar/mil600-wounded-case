import {PANELS, type PanelId} from '../content/panels';
import type {DemoProfile} from '../../shared/api';
import {Icon} from './Icon';

interface PanelNavProps {
  active: PanelId | null;
  disabled: boolean;
  onSelect: (profile: DemoProfile) => void;
}

/** Навігація панелями: бічна на широкому екрані, нижня на телефоні. */
export function PanelNav({active, disabled, onSelect}: PanelNavProps) {
  return (
    <nav className="panel-nav" aria-label="Демо-панелі">
      <div className="panel-nav__inner">
        <p className="panel-nav__label" aria-hidden="true">
          Демо-панелі
        </p>
        <ul className="panel-nav__list">
        {PANELS.map(panel => (
          <li key={panel.id}>
            <button
              type="button"
              className="panel-nav__item"
              aria-current={active === panel.id ? 'page' : undefined}
              disabled={disabled}
              onClick={() => onSelect(panel.profile)}
            >
              <Icon name={panel.icon} size={24} />
              <span>{panel.label}</span>
            </button>
          </li>
        ))}
        </ul>
      </div>
    </nav>
  );
}
