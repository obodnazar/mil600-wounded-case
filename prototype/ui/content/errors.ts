import {ApiError, NetworkError} from '../api/client';

export type ProblemKind =
  | 'network'
  | 'session'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unavailable'
  | 'unsynced'
  | 'unknown';

/** Що сталося — мовою людини, без технічних кодів. */
export interface Problem {
  kind: ProblemKind;
  title: string;
  message: string;
  /** Скільки секунд сервер просить зачекати (лише для rate_limited). */
  retryAfter: number | null;
}

/** read — завантаження панелі; write — команда чи подія; switch — зміна навчальної ролі. */
export type ProblemScope = 'read' | 'write' | 'switch';

const KEPT = 'Попередні підтвердження збережено.';

const CONFLICT_MESSAGES: Record<string, string> = {
  command_conflict: `Цей запит уже надходив з іншим змістом, тому сервер його не прийняв. ${KEPT}`,
  source_review_required: `Спершу потрібна звірка з джерелом — її робить супровід. ${KEPT}`,
  certificate_not_prepared: `Довідку ще не склала медична служба, тож видавати поки нічого. ${KEPT}`,
  certificate_already_issued: `Видачу довідки вже підтвердило джерело — повторний запит не потрібен. ${KEPT}`,
  request_pending: `Такий запит уже подано; чекаємо підтвердження джерела. ${KEPT}`,
  already_referred: `Направлення на ВЛК уже підтверджене — повторний запит не потрібен. ${KEPT}`,
  no_pending_copy: `Немає навчальної копії, що очікує перевірки. ${KEPT}`,
  no_open_request: `У кейсі немає відкритих звернень. ${KEPT}`,
  reserve_exists: `Резервний адміністративний запит уже створено. ${KEPT}`,
  task_not_closable: `Цю задачу закриває підтвердження джерела, а не кнопка. ${KEPT}`,
  review_not_closable: `Цей розбір не можна закрити вручну: його вирішує належне джерело. ${KEPT}`,
};

const NETWORK_MESSAGES: Record<ProblemScope, string> = {
  read: 'Немає зв’язку із сервером, тому дані не завантажено. Перевірте з’єднання й повторіть.',
  write:
    'Підтвердження дії не отримано, тому вона не вважається виконаною. Повторіть: запит піде ' +
    'з тим самим ключем, і подвійного запису не буде. Попередні дані збережено.',
  switch: 'Немає зв’язку із сервером, тому роль не змінено. Перевірте з’єднання й повторіть.',
};

function problem(kind: ProblemKind, title: string, message: string, retryAfter: number | null = null): Problem {
  return {kind, title, message, retryAfter};
}

function describeApiError(error: ApiError, scope: ProblemScope): Problem {
  const notSaved = scope === 'write' ? ' Дію не записано.' : '';
  if (error.status === 401) {
    return problem('session', 'Сесія завершилась', 'Почніть нову сесію й оберіть роль ще раз.');
  }
  if (error.status === 403) {
    const message = `Ваша навчальна роль цього не дозволяє.${notSaved}`;
    return problem('forbidden', 'Недостатньо прав для цієї дії', message);
  }
  if (error.status === 404) {
    return problem('not_found', 'Кейс недоступний', 'Кейс недоступний у вашій області.');
  }
  if (error.status === 409) {
    const message = CONFLICT_MESSAGES[error.code] ?? `Стан кейсу змінився, тому дію не виконано. ${KEPT}`;
    return problem('conflict', 'Дію не виконано', message);
  }
  if (error.status === 429) {
    const seconds = error.retryAfter ?? 60;
    const message = `Забагато запитів. Повторіть через ${seconds} с.`;
    return problem('rate_limited', 'Сервер просить зачекати', message, seconds);
  }
  if (error.status === 503) {
    const cause = error.code === 'audit_unavailable' ? 'Журнал аудиту недоступний' : 'Сервіс тимчасово недоступний';
    return problem('unavailable', 'Сервіс недоступний', `${cause}.${notSaved || ' Спробуйте пізніше.'}`);
  }
  return problem('unknown', 'Не вдалося виконати запит', `Дані не вважаються оновленими.${notSaved}`);
}

export function describeProblem(error: unknown, scope: ProblemScope): Problem {
  if (error instanceof ApiError) return describeApiError(error, scope);
  if (error instanceof NetworkError) return problem('network', 'Мережевий збій', NETWORK_MESSAGES[scope]);
  return problem('unknown', 'Щось пішло не так', 'Спробуйте ще раз. Дані не вважаються оновленими.');
}

const RETRIABLE: readonly ProblemKind[] = ['network', 'rate_limited', 'unavailable', 'unknown'];

/** Чи має сенс повторювати дію без змін: відмова в правах чи передумова повтором не знімається. */
export function isRetriable(problem: Problem): boolean {
  return RETRIABLE.includes(problem.kind);
}

export function isSessionEnded(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Успішний запис, після якого не вдалось оновити екран. */
export const UNSYNCED_PROBLEM: Problem = {
  kind: 'unsynced',
  title: 'Панель не оновлено',
  message:
    'Дію підтверджено сервером, але панель не оновлено. На екрані попередній стан — ' +
    'запис не втрачено. Оновіть панель, щоб побачити зміни.',
  retryAfter: null,
};

/** Кнопка «Оновити» не змогла отримати свіжі дані: на екрані лишається попередній стан. */
export function describeRefreshProblem(error: unknown): Problem {
  const described = describeProblem(error, 'read');
  if (described.kind !== 'network' && described.kind !== 'unknown') return described;
  return {
    ...described,
    title: 'Дані не оновлено',
    message: 'Не вдалося отримати свіжі дані. На екрані попередній стан; попередні підтвердження збережено.',
  };
}
