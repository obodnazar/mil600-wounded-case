import {useId} from 'react';
import type {ActionAvailability, StaffCaseView, StaffProfile} from '../../../shared/api';
import type {CommandDraft} from '../../app/useCommand';
import {Button} from '../../components/Button';
import {Icon} from '../../components/Icon';
import {Notice} from '../../components/Notice';
import {ACTION_COPY, COMMANDER_ACTIONS, STAFF_CASE_ACTIONS, UNAVAILABLE_REASONS} from '../../content/actions';
import {REFERRAL_NOTE} from '../../content/legal';
import {availabilityOf, awaitsSource} from './staffModel';

interface ActionTileProps {
  availability: ActionAvailability;
  busy: boolean;
  onRun: () => void;
}

/** Кнопка дії з поясненням: доступна — що зробить; недоступна — чому. */
export function ActionTile({availability, busy, onRun}: ActionTileProps) {
  const noteId = useId();
  const {action, available, reason} = availability;
  const copy = ACTION_COPY[action];
  const primary = available && COMMANDER_ACTIONS.includes(action);
  const unavailable = reason ? UNAVAILABLE_REASONS[reason] : 'Зараз недоступно для цього кейсу.';
  const note = available ? copy.hint : unavailable;
  return (
    <li className={available ? 'action-tile' : 'action-tile is-unavailable'}>
      <Button
        variant={primary ? 'primary' : 'secondary'}
        block
        disabled={busy || !available}
        aria-describedby={noteId}
        onClick={onRun}
      >
        {copy.label}
      </Button>
      <p id={noteId} className="action-tile__note">
        {!available && <Icon name="lock" size={16} />}
        <span>{note}</span>
      </p>
    </li>
  );
}

interface CaseActionsProps {
  item: StaffCaseView;
  profile: StaffProfile;
  busy: boolean;
  onCommand: (draft: CommandDraft) => void;
}

/** Дії з кейсом. Недоступні дії не ховаємо: показуємо вимкненими з причиною. */
export function CaseActions({item, profile, busy, onCommand}: CaseActionsProps) {
  const run = (availability: ActionAvailability) => {
    const option = availability.action === 'support_request' ? 'relative' : undefined;
    onCommand({caseId: item.id, action: availability.action, option});
  };
  return (
    <section className="case-block" aria-labelledby="case-actions-title">
      <h3 id="case-actions-title">Дії</h3>
      {awaitsSource(item) && (
        <Notice tone="info" title="Запит подано; чекаємо підтвердження джерела">
          Кнопка не створює підтвердженого документа: стан зміниться, коли підтвердження надійде від джерела.
        </Notice>
      )}
      <ul className="action-grid">
        {STAFF_CASE_ACTIONS.map(action => {
          const availability = availabilityOf(item, action, profile);
          return <ActionTile key={action} availability={availability} busy={busy} onRun={() => run(availability)} />;
        })}
      </ul>
      <p className="case-block__rule">{REFERRAL_NOTE}</p>
    </section>
  );
}
