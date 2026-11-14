import type {DemoProfile} from '../../../shared/api';
import {Icon} from '../../components/Icon';
import {Tag} from '../../components/StatusPill';
import {PANELS} from '../../content/panels';
import {GuideCard} from '../shared/GuideCard';

interface WelcomePanelProps {
  disabled: boolean;
  onSelect: (profile: DemoProfile) => void;
}

/** Стартовий екран: роль ще не вибрано. Вибір ролі — навчальний, це не автентифікація. */
export function WelcomePanel({disabled, onSelect}: WelcomePanelProps) {
  return (
    <>
      <header className="welcome-hero">
        <Tag accent>Навчальний прототип</Tag>
        <h1>
          Від події —<br />
          до зрозумілого кроку.
        </h1>
        <p>
          Концепт показує шлях військовослужбовця після поранення: медичні документи, довідка про
          обставини травми, ВЛК і виплати. Оберіть панель, щоб пройти його на вигаданих даних. Паролі та
          справжні документи не потрібні.
        </p>
      </header>
      <section aria-labelledby="welcome-panels-title">
        <h2 id="welcome-panels-title" className="welcome-subtitle">
          Оберіть панель
        </h2>
        <ul className="welcome-panels">
          {PANELS.map(panel => (
            <li key={panel.id}>
              <button
                type="button"
                className="welcome-panel"
                disabled={disabled}
                onClick={() => onSelect(panel.profile)}
              >
                <span className="welcome-panel__icon">
                  <Icon name={panel.icon} size={28} />
                </span>
                <span className="welcome-panel__audience">{panel.audience}</span>
                <span className="welcome-panel__title">{panel.title}</span>
                <span className="welcome-panel__text">{panel.description}</span>
                <span className="welcome-panel__go">
                  Відкрити
                  <Icon name="arrowRight" size={16} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="muted welcome-note">
          Вибір панелі — це навчальний вибір ролі на сервері, а не вхід: кожна роль бачить лише свою
          проєкцію даних.
        </p>
      </section>
      <section className="welcome-guide" aria-labelledby="welcome-guide-title">
        <h2 id="welcome-guide-title" className="welcome-subtitle">
          Допомога без входу
        </h2>
        <GuideCard />
      </section>
    </>
  );
}
