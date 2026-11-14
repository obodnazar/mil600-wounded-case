import type {ReactNode} from 'react';
import type {Freshness, ReviewView, SupportRequestView, TaskView} from '../../../shared/api';
import {StatusPill} from '../../components/StatusPill';
import {
  FRESHNESS,
  OWNER_LABELS,
  REQUEST_CATEGORY_LABELS,
  REQUEST_STATES,
  reviewReasonLabel,
  taskLabel,
} from '../../content/labels';

/** Позначка актуальності даних кейсу. */
export function FreshnessPill({freshness}: {freshness: Freshness}) {
  const {label, tone} = FRESHNESS[freshness];
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

interface TaskListProps {
  tasks: readonly TaskView[];
  /** Додаткова дія для задачі (наприклад, закрити вручну створене уточнення). */
  renderAction?: (task: TaskView) => ReactNode;
}

/** Відкриті задачі: що зробити й хто відповідальний. */
export function TaskList({tasks, renderAction}: TaskListProps) {
  return (
    <ul className="task-list">
      {tasks.map(task => (
        <li key={task.id} className="task-list__item">
          <div>
            <p className="task-list__title">{taskLabel(task)}</p>
            <p className="task-list__owner">Відповідає: {OWNER_LABELS[task.ownerRole]}</p>
          </div>
          {renderAction?.(task)}
        </li>
      ))}
    </ul>
  );
}

/** Звернення супроводу зі станом. */
export function RequestList({requests}: {requests: readonly SupportRequestView[]}) {
  return (
    <ul className="request-list">
      {requests.map(request => (
        <li key={request.id} className="request-list__item">
          <span>{REQUEST_CATEGORY_LABELS[request.category]}</span>
          <StatusPill tone={REQUEST_STATES[request.state].tone}>{REQUEST_STATES[request.state].label}</StatusPill>
        </li>
      ))}
    </ul>
  );
}

function reviewNote(review: ReviewView): string {
  if (review.resolvable) return 'Після ручної звірки з джерелом випадок можна підтвердити.';
  if (review.closable) {
    return (
      'Після звірки розбір можна закрити: подія лишається незастосованою, бізнес-стан не змінюється, ' +
      'джерело може надіслати її повторно.'
    );
  }
  return 'Вирішує належне джерело: кнопкою це не підтверджується.';
}

interface ReviewListProps {
  reviews: readonly ReviewView[];
  renderAction?: (review: ReviewView) => ReactNode;
}

/** Розбори: дані джерела, які потребують ручної звірки. */
export function ReviewList({reviews, renderAction}: ReviewListProps) {
  return (
    <ul className="review-list">
      {reviews.map(review => (
        <li key={review.id} className="review-list__item">
          <div>
            <p className="review-list__title">{reviewReasonLabel(review.reason)}</p>
            <p className="review-list__note">{reviewNote(review)}</p>
          </div>
          {renderAction?.(review)}
        </li>
      ))}
    </ul>
  );
}
