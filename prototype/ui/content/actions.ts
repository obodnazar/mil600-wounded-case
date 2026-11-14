import type {CommandAction, IngestStatus, UnavailableReason} from '../../shared/api';
import {REFERRAL_SIMPLIFICATION} from './legal';

export interface ActionCopy {
  label: string;
  /** Що саме зробить кнопка — коротке пояснення під нею. */
  hint: string;
}

export const ACTION_COPY: Record<CommandAction, ActionCopy> = {
  issue_certificate: {
    label: 'Запит видачі довідки',
    hint: 'Подає запит на видачу. Виданим документ стане лише після підтвердження джерела.',
  },
  refer_vlk: {
    label: 'Направити на ВЛК',
    hint: `Подає запит на направлення; неповний навчальний перелік його не блокує. ${REFERRAL_SIMPLIFICATION}`,
  },
  clarify: {
    label: 'Уточнити в автора',
    hint: 'Створює задачу уточнення в автора документа.',
  },
  verify_copy: {
    label: 'Перевірити навчальну копію',
    hint: 'Технічна звірка вигаданого зразка. Копія не стає оригіналом.',
  },
  support_request: {
    label: 'Звернення родини без нового доступу',
    hint: 'Реєструє звернення родини. Доступу до кейсу воно не створює.',
  },
  resolve_support: {
    label: 'Підготувати результат звернення',
    hint: 'Закриває відкриті звернення цього кейсу з підготовленою відповіддю.',
  },
  resolve_review: {
    label: 'Підтвердити випадок після звірки',
    hint: 'Лише після ручної звірки з джерелом.',
  },
  close_review: {
    label: 'Закрити після звірки з джерелом',
    hint: 'Подія лишається незастосованою, бізнес-стан не змінюється; джерело може надіслати її повторно.',
  },
  resolve_task: {
    label: 'Закрити уточнення',
    hint: 'Закриває уточнення, створене вручну.',
  },
  admin_open: {
    label: 'Створити адміністративний запит',
    hint: 'Резервний шлях без еПМК. Медичного факту не створює.',
  },
  copy: {
    label: 'Додати навчальну копію довідки',
    hint: 'Вигаданий зразок із готової галереї. Копія не є оригіналом.',
  },
  gap: {
    label: 'Позначити пропущене підтвердження',
    hint: 'Створює задачу звірки з джерелом.',
  },
};

/** Дії кейсу в службовій панелі — у порядку показу. */
export const STAFF_CASE_ACTIONS: readonly CommandAction[] = [
  'issue_certificate',
  'refer_vlk',
  'clarify',
  'verify_copy',
  'support_request',
  'resolve_support',
];

/** Дії, які виконує тільки командир. */
export const COMMANDER_ACTIONS: readonly CommandAction[] = ['issue_certificate', 'refer_vlk'];

export const UNAVAILABLE_REASONS: Record<UnavailableReason, string> = {
  commander_only: 'Виконує командир. Перемкніть роль на «Командир», щоб подати запит.',
  certificate_not_prepared: 'Довідку ще не склала медична служба — видавати нічого.',
  certificate_already_issued: 'Видачу довідки вже підтвердило джерело.',
  request_pending: 'Запит уже подано; чекаємо підтвердження джерела.',
  already_referred: 'Направлення на ВЛК уже підтверджене джерелом.',
  no_pending_copy: 'Немає навчальної копії, що очікує перевірки.',
  no_open_request: 'Немає відкритих звернень у цьому кейсі.',
  reserve_exists: 'Резервний адміністративний запит уже створено.',
};

const SAVED = 'Запит збережено.';
const AWAITING_SOURCE = 'Запит подано; чекаємо підтвердження джерела — кнопка не створює підтвердженого документа.';

const COMMAND_RESULTS: Record<CommandAction, string> = {
  issue_certificate: `${SAVED} ${AWAITING_SOURCE}`,
  refer_vlk: `${SAVED} ${AWAITING_SOURCE}`,
  clarify: `${SAVED} Створено задачу уточнення в автора документа.`,
  verify_copy: `${SAVED} Навчальну копію технічно перевірено; оригінал підтверджує джерело.`,
  support_request: `${SAVED} Звернення передано супроводу; стан видно в розділі допомоги.`,
  resolve_support: `${SAVED} Результат звернення підготовлено.`,
  resolve_review: `${SAVED} Випадок підтверджено після ручної звірки.`,
  close_review: `${SAVED} Розбір закрито після звірки; подію не застосовано, стан кейсу не змінено.`,
  resolve_task: `${SAVED} Уточнення закрито.`,
  admin_open: `${SAVED} Резервний запит відкрито; медичного факту він не створює.`,
  copy: `${SAVED} Зразок додано як навчальну копію — це не оригінал документа.`,
  gap: `${SAVED} Підтвердження джерела відстежується окремо.`,
};

const OPTION_RESULTS: Record<string, string> = {
  'support_request:relative': `${SAVED} Звернення родини зареєстровано; доступу до кейсу воно не створює.`,
  'copy:wrong_kind': `${SAVED} Зразок іншого виду додано — перелік покаже помилку виду.`,
};

const DUPLICATE_NOTE = ' Це повтор: сервер повернув той самий результат без подвійного запису.';

export function commandResultMessage(action: CommandAction, option: string | undefined, duplicate: boolean): string {
  const base = (option && OPTION_RESULTS[`${action}:${option}`]) || COMMAND_RESULTS[action];
  return duplicate ? base + DUPLICATE_NOTE : base;
}

/** Повторна доставка події, яка досі чекає на розбір (HTTP 200, а не 202). */
export const INGEST_STILL_PENDING =
  'Подія досі на розборі: попередника або звірки ще немає. Бізнес-стан не змінено.';

export const INGEST_RESULTS: Record<IngestStatus, string> = {
  accepted: 'Прийнято. Подію, зміну кейсу, задачу й запис аудиту збережено разом.',
  duplicate: 'Повтор: нових кейсів, задач і повідомлень не створено.',
  pending_review: 'Подію збережено на розбір. Бізнес-стан не змінено.',
  event_conflict:
    'Конфлікт: та сама подія надійшла з іншим змістом. Стан кейсу не змінено, попередні підтвердження збережено.',
};

export const SNAPSHOT_RESULT = 'Фіксований зріз обрано. Перейдіть до панелі «Аналітика», щоб побачити його.';
