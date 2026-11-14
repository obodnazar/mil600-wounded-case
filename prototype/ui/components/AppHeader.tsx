import {PRODUCT_NAME, PRODUCT_NOTE} from '../content/panels';
import {formatTime} from '../lib/dates';
import {Button} from './Button';
import {Icon} from './Icon';

interface AppHeaderProps {
  /** Підпис поточної навчальної ролі або null, якщо роль не вибрано. */
  roleLabel: string | null;
  /** Коли панель востаннє отримала дані (мс) або null. */
  loadedAt: number | null;
  /** Останнє оновлення не вдалося: на екрані попередній стан. */
  stale: boolean;
  canRefresh: boolean;
  canGoHome: boolean;
  onRefresh: () => void;
  onHome: () => void;
}

/** Шапка: назва концепту, поточна роль і оновлення даних. */
export function AppHeader(props: AppHeaderProps) {
  const {roleLabel, loadedAt, stale, canRefresh, canGoHome, onRefresh, onHome} = props;
  const time = formatTime(loadedAt);
  return (
    <header className="app-header">
      <button type="button" className="brand" onClick={onHome} disabled={!canGoHome}>
        <span className="brand__mark">
          <Icon name="route" size={24} />
        </span>
        <span className="brand__text">
          <span className="brand__name">{PRODUCT_NAME}</span>
          <span className="brand__note">{PRODUCT_NOTE}</span>
        </span>
        <span className="visually-hidden">: до вибору ролі</span>
      </button>
      <div className="app-header__session">
        <p className="role-chip">
          <Icon name="user" size={16} />
          <span className="visually-hidden">Навчальна роль: </span>
          <span>{roleLabel ?? 'Роль не вибрано'}</span>
        </p>
        {roleLabel && time && (
          <p className={stale ? 'sync-note sync-note--stale' : 'sync-note'}>
            {stale ? `Не оновлено · стан на ${time}` : `Оновлено о ${time}`}
          </p>
        )}
        {roleLabel && (
          <Button className="refresh-button" icon="refresh" disabled={!canRefresh} onClick={onRefresh}>
            Оновити
          </Button>
        )}
      </div>
    </header>
  );
}
