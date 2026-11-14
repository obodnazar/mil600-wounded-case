import type {StaffCaseView} from '../../../shared/api';
import {Icon} from '../../components/Icon';
import {StatusPill} from '../../components/StatusPill';
import {STAGE_LABELS, taskLabel} from '../../content/labels';
import {formatShortDay} from '../../lib/dates';

function DeadlineMark({item}: {item: StaffCaseView}) {
  const {dueDate, followUpDate, reviewOpen, anchorStatus} = item.certificateDeadline;
  if (dueDate) {
    return (
      <StatusPill tone={reviewOpen ? 'attention' : 'pending'}>
        {reviewOpen ? 'Строк сплив' : 'Строк'}: {formatShortDay(dueDate)}
      </StatusPill>
    );
  }
  if (anchorStatus === 'estimated' && followUpDate) {
    return <StatusPill tone="unknown">Орієнтир: {formatShortDay(followUpDate)}</StatusPill>;
  }
  return null;
}

interface CaseListItemProps {
  item: StaffCaseView;
  selected: boolean;
  onSelect: () => void;
}

/** Рядок списку кейсів: наступна задача й позначки, що потребують уваги. */
export function CaseListItem({item, selected, onSelect}: CaseListItemProps) {
  const first = item.tasks[0];
  const openRequests = item.requests.filter(request => request.state === 'open').length;
  return (
    <li>
      <button type="button" className="case-item" aria-current={selected ? 'true' : undefined} onClick={onSelect}>
        <span className="case-item__top">
          <span className="case-item__label">{item.label}</span>
          <span className="case-item__stage">{STAGE_LABELS[item.stage]}</span>
        </span>
        <span className="case-item__task">{first ? taskLabel(first) : 'Відкритих задач немає'}</span>
        <span className="case-item__marks">
          {item.origin === 'administrative_request' && <StatusPill tone="neutral">Резервний запит</StatusPill>}
          {item.reviews.length > 0 && <StatusPill tone="conflict">Потрібна звірка</StatusPill>}
          {item.freshness === 'stale' && <StatusPill tone="attention">Дані не оновлено</StatusPill>}
          {item.freshness === 'conflict' && <StatusPill tone="conflict">Є суперечність</StatusPill>}
          <DeadlineMark item={item} />
          {openRequests > 0 && <StatusPill tone="pending">Звернення: {openRequests}</StatusPill>}
        </span>
        <span className="case-item__arrow">
          <Icon name="arrowRight" size={16} />
        </span>
      </button>
    </li>
  );
}
