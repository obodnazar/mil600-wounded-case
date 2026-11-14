import type {FixtureView, SimulatorMode} from '../../../shared/api';
import type {SimulatorOutcome} from '../../app/useSimulator';
import {Button} from '../../components/Button';
import {Card} from '../../components/Card';
import {Tag} from '../../components/StatusPill';
import {FixturePicker} from './FixturePicker';

const OUTCOME_TONES: Record<NonNullable<SimulatorOutcome>, string> = {
  accepted: 'ok',
  duplicate: 'neutral',
  pending_review: 'warn',
  event_conflict: 'conflict',
  snapshot: 'ok',
};

interface SimulatorCardProps {
  fixtures: readonly FixtureView[];
  selected: FixtureView;
  sent: readonly string[];
  busy: boolean;
  /** Текст останнього результату або null, якщо відповіді сервера ще не було. */
  result: string | null;
  outcome: SimulatorOutcome;
  onSelect: (id: string) => void;
  onSend: (mode: SimulatorMode) => void;
}

/** Надсилання навчальної події: звичайне, повторне й із конфліктом. */
export function SimulatorCard(props: SimulatorCardProps) {
  const {fixtures, selected, sent, busy, result, outcome, onSelect, onSend} = props;
  const tone = result && outcome ? OUTCOME_TONES[outcome] : 'idle';
  return (
    <Card as="section" className="simulator" labelledBy="simulator-title">
      <Tag accent>Джерельний маршрут</Tag>
      <h2 id="simulator-title">Подія — підтвердження — наступна дія</h2>
      <p>Кейс оновлюється від події джерела, без дії бійця.</p>
      <FixturePicker fixtures={fixtures} selected={selected} sent={sent} onSelect={onSelect} />
      <div className="simulator__actions">
        <Button variant="primary" icon="send" disabled={busy} onClick={() => onSend('send')}>
          Надіслати
        </Button>
        <Button icon="repeat" disabled={busy} onClick={() => onSend('repeat')}>
          Повторити ту саму подію
        </Button>
        <Button icon="bolt" disabled={busy} onClick={() => onSend('conflict')}>
          Перевірити конфлікт після приймання
        </Button>
      </div>
      <p className={`result result--${tone}`} role="status" aria-live="polite">
        {result ?? 'Результат з’явиться тільки після відповіді сервера.'}
      </p>
    </Card>
  );
}
