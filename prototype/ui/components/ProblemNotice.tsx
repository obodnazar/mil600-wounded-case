import type {ReactNode} from 'react';
import type {Problem, ProblemKind} from '../content/errors';
import {useCountdown} from '../lib/hooks';
import {Button} from './Button';
import {Notice, type NoticeTone} from './Notice';

const TONES: Record<ProblemKind, NoticeTone> = {
  network: 'danger',
  session: 'warning',
  forbidden: 'danger',
  not_found: 'warning',
  conflict: 'warning',
  rate_limited: 'warning',
  unavailable: 'danger',
  unsynced: 'warning',
  unknown: 'danger',
};

export interface RetryAction {
  label: string;
  run: () => void;
}

interface ProblemNoticeProps {
  problem: Problem;
  retry?: RetryAction | null | undefined;
  /** Додаткові кнопки поруч із повтором. */
  extra?: ReactNode;
  busy?: boolean;
  className?: string | undefined;
}

/** Помилка людською мовою з кнопкою повтору; за 429 кнопка чекає, скільки просить сервер. */
export function ProblemNotice({problem, retry, extra, busy = false, className}: ProblemNoticeProps) {
  const left = useCountdown(problem.retryAfter, problem);
  const waiting = left > 0;
  const limited = problem.kind === 'rate_limited';
  const message = limited && !waiting ? 'Забагато запитів. Тепер можна повторити.' : problem.message;
  const actions = (retry || extra) && (
    <>
      {retry && (
        <Button variant="primary" icon="refresh" disabled={busy || waiting} onClick={retry.run}>
          {waiting ? `${retry.label} через ${left} с` : retry.label}
        </Button>
      )}
      {extra}
    </>
  );
  return (
    <Notice tone={TONES[problem.kind]} title={problem.title} role="alert" actions={actions} className={className}>
      {message}
    </Notice>
  );
}
