import type {StaffProfile, StaffView} from '../../../shared/api';
import type {CommandDraft} from '../../app/useCommand';
import {EmptyState} from '../../components/EmptyState';
import {PageHeader} from '../../components/PageHeader';
import {Segmented} from '../../components/Segmented';
import {PROFILE_LABELS} from '../../content/labels';
import {useMediaQuery} from '../../lib/hooks';
import {CaseDetail} from './CaseDetail';
import {CaseList} from './CaseList';
import {ReserveCard} from './ReserveCard';

const ROLE_OPTIONS: readonly {value: StaffProfile; label: string}[] = [
  {value: 'support', label: PROFILE_LABELS.support},
  {value: 'commander', label: PROFILE_LABELS.commander},
];

const ROLE_NOTES: Record<StaffProfile, string> = {
  support: 'Супровід уточнює невідоме й знімає зайве з бійця. Видачу довідки й направлення на ВЛК подає командир.',
  commander: 'Командир подає запит видачі довідки й направлення на ВЛК. Підтверджує їх джерело, а не кнопка.',
};

interface StaffPanelProps {
  view: StaffView;
  busy: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onProfile: (profile: StaffProfile) => void;
  onCommand: (draft: CommandDraft) => void;
}

/** Службова панель: список призначених кейсів і деталі вибраного. */
export function StaffPanel({view, busy, selectedId, onSelect, onProfile, onCommand}: StaffPanelProps) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const chosen = view.cases.find(item => item.id === selectedId) ?? null;
  const detail = chosen ?? (wide ? (view.cases[0] ?? null) : null);
  const showList = wide || detail === null;

  return (
    <>
      <PageHeader
        eyebrow="Призначена область доступу"
        title="Супровід кейсів"
        lead={ROLE_NOTES[view.profile]}
        aside={
          <Segmented
            label="Навчальна роль у частині"
            options={ROLE_OPTIONS}
            value={view.profile}
            onChange={onProfile}
            disabled={busy}
          />
        }
      />
      <div className={wide ? 'staff-layout staff-layout--wide' : 'staff-layout'}>
        {showList && (
          <div className="staff-layout__list">
            <CaseList cases={view.cases} selectedId={detail?.id ?? null} onSelect={onSelect} />
          </div>
        )}
        {detail && (
          <CaseDetail
            item={detail}
            profile={view.profile}
            busy={busy}
            onBack={wide ? null : () => onSelect(null)}
            onCommand={onCommand}
          />
        )}
        {wide && !detail && (
          <EmptyState icon="people" title="Кейс не вибрано">
            Коли у вашій області з’явиться кейс, його деталі будуть тут.
          </EmptyState>
        )}
      </div>
      {showList && <ReserveCard reserve={view.reserve} busy={busy} onCommand={onCommand} />}
      <p className="page-footnote">
        Службова проєкція: клінічні документи й документні посилання сюди не передаються. Заклад лікування
        і стан виплат — лише в межах адресного мінімуму, без сум.
      </p>
    </>
  );
}
