import {useCallback, useEffect, useRef, useState} from 'react';
import type {RetryAction} from '../components/ProblemNotice';
import {
  describeProblem,
  describeRefreshProblem,
  isRetriable,
  isSessionEnded,
  UNSYNCED_PROBLEM,
  type Problem,
} from '../content/errors';
import {useLatest} from '../lib/hooks';

/** Відгук на останню дію користувача. */
export interface Feedback {
  /** Підтверджений сервером результат запису. */
  result: string | null;
  problem: Problem | null;
  retry: RetryAction | null;
  /** Запис підтверджено, але екран не оновився: результат і попередження показуємо разом. */
  unsynced: boolean;
}

const EMPTY: Feedback = {result: null, problem: null, retry: null, unsynced: false};

export interface MutationSpec<T> {
  send: () => Promise<T>;
  /** Текст результату; викликається лише після підтвердження сервера. */
  describe: (value: T) => string;
  /** Повторити ту саму дію (для команд — з тим самим ключем ідемпотентності). */
  retry: () => void;
}

export type RunMutation = <T>(spec: MutationSpec<T>) => Promise<boolean>;

interface Options {
  reload: () => Promise<void>;
  onSessionEnded: () => void;
}

/**
 * Виконує записи й веде відгук. Успіх показується тільки після відповіді сервера;
 * невдале оновлення екрана після успішного запису не скасовує сам запис.
 */
export function useMutation(options: Options) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(EMPTY);
  const latest = useLatest({...options, feedback});

  const refreshRef = useRef<() => void>(() => undefined);

  const sync = useCallback(
    async (result: string | null): Promise<void> => {
      const retry: RetryAction = {label: 'Оновити панель', run: () => refreshRef.current()};
      try {
        await latest.current.reload();
        setFeedback({...EMPTY, result});
      } catch (error) {
        if (isSessionEnded(error)) return latest.current.onSessionEnded();
        const problem = result ? UNSYNCED_PROBLEM : describeRefreshProblem(error);
        setFeedback({result, problem, retry, unsynced: result !== null});
      }
    },
    [latest],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const {feedback: shown} = latest.current;
    setBusy(true);
    await sync(shown.unsynced ? shown.result : null);
    setBusy(false);
  }, [latest, sync]);

  useEffect(() => {
    refreshRef.current = () => void refresh();
  }, [refresh]);

  const run = useCallback(
    async <T,>(spec: MutationSpec<T>): Promise<boolean> => {
      setBusy(true);
      setFeedback(EMPTY);
      try {
        const result = spec.describe(await spec.send());
        setFeedback({...EMPTY, result});
        await sync(result);
        return true;
      } catch (error) {
        if (isSessionEnded(error)) latest.current.onSessionEnded();
        else {
          const problem = describeProblem(error, 'write');
          const retry: RetryAction | null = isRetriable(problem) ? {label: 'Повторити', run: spec.retry} : null;
          setFeedback({...EMPTY, problem, retry});
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [latest, sync],
  );

  const reset = useCallback(() => setFeedback(EMPTY), []);
  const dismissResult = useCallback(() => setFeedback(shown => ({...shown, result: null, unsynced: false})), []);
  const dismissProblem = useCallback(() => setFeedback(shown => ({...shown, problem: null, retry: null})), []);

  return {busy, feedback, run, refresh, reset, dismissResult, dismissProblem};
}
