import type {PatientCaseView} from '../../../shared/api';
import {Card} from '../../components/Card';
import {StatusPill} from '../../components/StatusPill';
import type {Tone} from '../../content/labels';
import {buildFacts} from './facts';

const TONE_WORDS: Record<Tone, string> = {
  confirmed: 'Підтверджено',
  pending: 'Очікує',
  unknown: 'Невідомо',
  attention: 'Потрібна увага',
  conflict: 'Суперечність',
  neutral: 'Не застосовується',
};

/** Що вже підтверджено джерелом, що очікує, а що невідомо. */
export function FactsCard({view}: {view: PatientCaseView}) {
  return (
    <Card>
      <dl className="facts">
        {buildFacts(view).map(item => (
          <div key={item.id} className="facts__row">
            <dt>{item.label}</dt>
            <dd>
              <span className="facts__value">{item.value}</span>
              <StatusPill tone={item.tone}>{TONE_WORDS[item.tone]}</StatusPill>
            </dd>
          </div>
        ))}
      </dl>
      <p className="card__note">
        Тут лише те, що передало джерело. Заклад лікування — умовна назва без адреси.
      </p>
    </Card>
  );
}
