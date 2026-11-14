import {useEffect, useRef} from 'react';
import type {StaffCaseView, StaffProfile} from '../../../shared/api';
import type {CommandDraft} from '../../app/useCommand';
import {Button} from '../../components/Button';
import {Card} from '../../components/Card';
import {DateText} from '../../components/DateText';
import {Notice} from '../../components/Notice';
import {StatusPill, Tag} from '../../components/StatusPill';
import {ACTION_COPY} from '../../content/actions';
import {describeFreshness, FRESHNESS, STAGE_LABELS} from '../../content/labels';
import {CERTIFICATE_RULE, SERVICE_RULE} from '../../content/legal';
import {RequestList, ReviewList, TaskList} from '../shared/CaseBits';
import {DeadlineCard} from '../shared/DeadlineCard';
import {summarizeCertificateDeadline} from '../shared/deadlines';
import {CaseActions} from './CaseActions';

interface CaseDetailProps {
  item: StaffCaseView;
  profile: StaffProfile;
  busy: boolean;
  /** На телефоні деталі — окремий крок із поверненням до списку. */
  onBack: (() => void) | null;
  onCommand: (draft: CommandDraft) => void;
}

/** Деталі кейсу для супроводу: стан, строк, задачі, розбори, звернення й дії. */
export function CaseDetail({item, profile, busy, onBack, onCommand}: CaseDetailProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const stepped = onBack !== null;
  const freshness = describeFreshness(item.freshness, item.lastSourceAt);
  useEffect(() => {
    if (stepped) heading.current?.focus();
  }, [stepped, item.id]);
  const command = (action: 'resolve_task' | 'resolve_review' | 'close_review', option: string) => (
    <Button disabled={busy} onClick={() => onCommand({caseId: item.id, action, option})}>
      {ACTION_COPY[action].label}
    </Button>
  );

  return (
    <Card as="section" className="case-detail" labelledBy="case-detail-title">
      {onBack && (
        <Button variant="ghost" icon="arrowLeft" onClick={onBack}>
          До списку кейсів
        </Button>
      )}
      <header className="case-detail__head">
        <p className="eyebrow">Вибраний кейс</p>
        <h2 id="case-detail-title" ref={heading} tabIndex={-1}>
          {item.label}
        </h2>
        <div className="case-detail__marks">
          <Tag>{STAGE_LABELS[item.stage]}</Tag>
          <StatusPill tone={freshness.tone}>{freshness.label}</StatusPill>
          {item.origin === 'administrative_request' && <Tag>Резервний адміністративний запит</Tag>}
        </div>
        <p className="muted">
          {item.lastSourceAt ? (
            <>
              Останнє підтвердження джерела: <DateText value={item.lastSourceAt} withTime />
            </>
          ) : (
            freshness.detail
          )}
        </p>
      </header>
      {!item.sourceLinked && (
        <Notice tone="info" title="Медичний документ ще не підтверджений">
          Кейс відкрито без підтвердження джерела. Медичний факт з’явиться лише від джерела.
        </Notice>
      )}
      {(item.freshness === 'stale' || item.freshness === 'conflict') && (
        <Notice tone="warning" title={FRESHNESS[item.freshness].label}>
          {FRESHNESS[item.freshness].detail}
        </Notice>
      )}
      <section className="case-block" aria-labelledby="case-tasks-title">
        <h3 id="case-tasks-title">Відкриті задачі</h3>
        {item.tasks.length > 0 ? (
          <TaskList tasks={item.tasks} renderAction={task => (task.manual ? command('resolve_task', task.id) : null)} />
        ) : (
          <p className="muted">Відкритих задач немає: чекаємо наступного підтвердження джерела.</p>
        )}
      </section>
      <section className="case-block" aria-labelledby="case-reviews-title">
        <h3 id="case-reviews-title">Звірка з джерелом</h3>
        {item.reviews.length > 0 ? (
          <ReviewList
            reviews={item.reviews}
            renderAction={review => {
              if (review.resolvable) return command('resolve_review', review.id);
              return review.closable ? command('close_review', review.id) : null;
            }}
          />
        ) : (
          <p className="muted">Розборів немає: дані джерел узгоджені.</p>
        )}
      </section>
      <section className="case-block" aria-labelledby="case-requests-title">
        <h3 id="case-requests-title">Звернення</h3>
        {item.requests.length > 0 ? (
          <RequestList requests={item.requests} />
        ) : (
          <p className="muted">Звернень у цьому кейсі немає.</p>
        )}
      </section>
      <CaseActions item={item} profile={profile} busy={busy} onCommand={onCommand} />
      <section className="case-block" aria-labelledby="case-deadline-title">
        <h3 id="case-deadline-title" className="visually-hidden">
          Строк довідки
        </h3>
        <DeadlineCard rule={CERTIFICATE_RULE} summary={summarizeCertificateDeadline(item.certificateDeadline)} />
        <p className="case-block__rule">{SERVICE_RULE}</p>
      </section>
    </Card>
  );
}
