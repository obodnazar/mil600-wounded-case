import type {FixtureView} from '../../../shared/api';
import {Button} from '../../components/Button';
import {Icon} from '../../components/Icon';
import {D1_PATH} from '../../content/dev';

interface DemoPathProps {
  fixtures: readonly FixtureView[];
  selectedId: string;
  sent: readonly string[];
  onSelect: (id: string) => void;
  onClearSent: () => void;
}

/** Шпаргалка порядку D1: кожна подія — кнопка, що вибирає її в симуляторі. */
export function DemoPath({fixtures, selectedId, sent, onSelect, onClearSent}: DemoPathProps) {
  const known = new Map(fixtures.map(fixture => [fixture.id, fixture]));
  return (
    <div className="demo-path">
      <ol className="demo-path__steps">
        {D1_PATH.map((step, index) => (
          <li key={index} className={`demo-path__step demo-path__step--${step.kind}`}>
            <h3>{step.title}</h3>
            {step.kind === 'panel' ? (
              <p>{step.text}</p>
            ) : (
              <ol className="demo-path__events">
                {step.fixtures.map(id => {
                  const fixture = known.get(id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className="demo-path__event"
                        aria-pressed={id === selectedId}
                        disabled={!fixture}
                        onClick={() => onSelect(id)}
                      >
                        {sent.includes(id) && <Icon name="check" size={16} />}
                        <span>{fixture ? fixture.title : `${id} — немає в переліку`}</span>
                        {sent.includes(id) && <span className="visually-hidden"> — надіслано з цієї вкладки</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </li>
        ))}
      </ol>
      <div className="demo-path__foot">
        <p className="muted">
          Натисніть подію, щоб вибрати її вище, і надішліть. Позначки «надіслано» — пам’ять цієї вкладки, а
          не стан сервера.
        </p>
        <Button variant="ghost" disabled={sent.length === 0} onClick={onClearSent}>
          Скинути позначки
        </Button>
      </div>
    </div>
  );
}
