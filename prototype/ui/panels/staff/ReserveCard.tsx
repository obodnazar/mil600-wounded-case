import type {StaffView} from '../../../shared/api';
import type {CommandDraft} from '../../app/useCommand';
import {Card} from '../../components/Card';
import {Tag} from '../../components/StatusPill';
import {ActionTile} from './CaseActions';

interface ReserveCardProps {
  reserve: StaffView['reserve'];
  busy: boolean;
  onCommand: (draft: CommandDraft) => void;
}

/** Резервний шлях без еПМК: адміністративний запит, який не створює медичного факту. */
export function ReserveCard({reserve, busy, onCommand}: ReserveCardProps) {
  const run = () => onCommand({caseId: reserve.baseCaseId, action: 'admin_open', option: 'primary_unavailable'});
  return (
    <Card surface="outline" as="section" className="reserve" labelledBy="reserve-title">
      <div>
        <Tag>Резервний шлях</Tag>
        <h2 id="reserve-title">Якщо подія еПМК недоступна</h2>
        <p>
          Супровід може відкрити адміністративний запит для фіксованого навчального учасника. Запит
          <strong> не створює медичного факту</strong>: лікування, документи й строки з’являться тільки після
          підтвердження джерела.
        </p>
      </div>
      <ul className="action-grid action-grid--single">
        <ActionTile availability={reserve.action} busy={busy} onRun={run} />
      </ul>
    </Card>
  );
}
