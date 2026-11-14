import type {PatientCaseView} from '../../../shared/api';
import {Card} from '../../components/Card';
import {Icon} from '../../components/Icon';
import {Tag} from '../../components/StatusPill';
import {OWNER_LABELS, taskLabel} from '../../content/labels';
import {TaskList} from '../shared/CaseBits';

interface NextStep {
  headline: string;
  owner: string;
  note: string;
}

function nextStep(view: PatientCaseView): NextStep {
  const first = view.tasks[0];
  if (view.reviews.length > 0) {
    return {
      headline: 'Потрібна звірка з джерелом',
      owner: OWNER_LABELS.support,
      note: 'Звірку робить супровід. Попередні підтвердження збережено — нічого не втрачено.',
    };
  }
  if (first) {
    return {
      headline: taskLabel(first),
      owner: OWNER_LABELS[first.ownerRole],
      note: 'Від вас зараз нічого не потрібно. Якщо щось незрозуміло — попросіть уточнення.',
    };
  }
  return {
    headline: 'Очікуємо наступне підтвердження джерела',
    owner: 'Належне джерело',
    note: 'Від вас дій не потрібно.',
  };
}

/** Наступна дія й відповідальний — головна відповідь першого екрана. */
export function NextStepCard({view}: {view: PatientCaseView}) {
  const step = nextStep(view);
  const others = view.reviews.length > 0 ? view.tasks : view.tasks.slice(1);
  return (
    <Card as="section" className="next-step" labelledBy="next-step-title">
      <Tag accent>Наступний крок</Tag>
      <h2 id="next-step-title" className="next-step__headline">
        {step.headline}
      </h2>
      <div className="next-step__owner">
        <span className="next-step__avatar">
          <Icon name="user" size={24} />
        </span>
        <p>
          <span className="next-step__owner-label">Відповідає</span>
          <strong>{step.owner}</strong>
        </p>
      </div>
      <p className="next-step__note">{step.note}</p>
      {others.length > 0 && (
        <details className="disclosure">
          <summary>Ще відкриті задачі: {others.length}</summary>
          <TaskList tasks={others} />
        </details>
      )}
      <div className="next-step__actions">
        <a className="btn btn--primary" href="#next">
          <span className="btn__label">Що буде далі</span>
          <Icon name="arrowRight" />
        </a>
        <a className="btn btn--secondary" href="#help">
          <span className="btn__label">Як отримати допомогу</span>
        </a>
      </div>
    </Card>
  );
}
