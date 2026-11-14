import type {Problem} from '../content/errors';
import {Button} from './Button';
import {Notice} from './Notice';
import {ProblemNotice, type RetryAction} from './ProblemNotice';

interface FeedbackDockProps {
  /** Підтверджений сервером результат дії. */
  result: string | null;
  problem: Problem | null;
  retry: RetryAction | null;
  busy: boolean;
  onDismissResult: () => void;
  onDismissProblem: () => void;
}

/** Закріплена зона відгуку на дії: видима незалежно від місця прокрутки сторінки. */
export function FeedbackDock(props: FeedbackDockProps) {
  const {result, problem, retry, busy, onDismissResult, onDismissProblem} = props;
  if (!result && !problem) return null;
  return (
    <div className="feedback-dock">
      {result && (
        <Notice
          tone="success"
          role="status"
          className="global-result"
          actions={
            <Button variant="ghost" onClick={onDismissResult}>
              Зрозуміло
            </Button>
          }
        >
          {result}
        </Notice>
      )}
      {problem && (
        <ProblemNotice
          problem={problem}
          retry={retry}
          busy={busy}
          extra={
            <Button variant="ghost" onClick={onDismissProblem}>
              Закрити
            </Button>
          }
        />
      )}
    </div>
  );
}
