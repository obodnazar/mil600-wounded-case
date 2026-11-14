import type {DemoProfile} from '../../shared/api';
import {Button} from '../components/Button';
import {Skeleton} from '../components/Skeleton';
import {PageHeader} from '../components/PageHeader';
import {panelOf, PANELS, type PanelId} from '../content/panels';
import {AnalyticsPanel} from '../panels/analytics/AnalyticsPanel';
import {DevPanel} from '../panels/dev/DevPanel';
import {PatientPanel} from '../panels/patient/PatientPanel';
import {StaffPanel} from '../panels/staff/StaffPanel';
import {WelcomePanel} from '../panels/welcome/WelcomePanel';
import {ProblemScreen, SessionEndedScreen} from './screens';
import type {RunCommand} from './useCommand';
import type {PanelController, PanelData} from './usePanelData';
import type {SessionController} from './useSession';
import type {SimulatorController} from './useSimulator';

interface MainContentProps {
  session: SessionController;
  panel: PanelController;
  busy: boolean;
  result: string | null;
  simulator: SimulatorController;
  staffCase: string | null;
  onStaffCase: (id: string | null) => void;
  onChoose: (profile: DemoProfile | null) => void;
  onCommand: RunCommand;
}

const EYEBROWS: Record<PanelId, string> = {
  patient: 'Шлях після поранення',
  staff: 'Призначена область доступу',
  analytics: 'Вимір процесу',
  dev: 'Лише навчальні події',
};

function panelTitle(id: PanelId): string {
  return PANELS.find(item => item.id === id)?.title ?? '';
}

function LoadingPanel({id}: {id: PanelId | null}) {
  if (!id) return <Skeleton layout="welcome" />;
  return (
    <>
      <PageHeader eyebrow={EYEBROWS[id]} title={panelTitle(id)} />
      <Skeleton layout={id} />
    </>
  );
}

type ReadyProps = Omit<MainContentProps, 'session' | 'panel'> & {data: PanelData};

function ReadyPanel({data, busy, result, simulator, staffCase, onStaffCase, onChoose, onCommand}: ReadyProps) {
  switch (data.panel) {
    case 'patient':
      return <PatientPanel view={data.view} busy={busy} onCommand={onCommand} />;
    case 'staff':
      return (
        <StaffPanel
          view={data.view}
          busy={busy}
          selectedId={staffCase}
          onSelect={onStaffCase}
          onProfile={onChoose}
          onCommand={onCommand}
        />
      );
    case 'analytics':
      return <AnalyticsPanel view={data.view} />;
    case 'dev':
      return <DevPanel view={data.view} busy={busy} result={result} simulator={simulator} />;
  }
}

/** Вибирає, що показати в основній зоні: стан сесії, завантаження, помилку чи панель ролі. */
export function MainContent(props: MainContentProps) {
  const {session, panel, onChoose} = props;
  const toRoles = <Button onClick={() => onChoose(null)}>До вибору ролі</Button>;

  if (session.phase === 'loading') return <Skeleton layout="welcome" label="Готуємо навчальну сесію…" />;
  if (session.phase === 'ended') return <SessionEndedScreen onRestart={() => void session.start()} />;
  if (session.phase === 'unreachable' && session.problem) {
    const retry = {label: 'Спробувати ще раз', run: () => void session.start()};
    return <ProblemScreen eyebrow="Немає зв’язку" title="Сервер недоступний" problem={session.problem} retry={retry} />;
  }
  if (session.switching) return <LoadingPanel id={panelOf(session.target ?? null)} />;
  if (session.problem) {
    const target = session.target ?? null;
    const id = panelOf(target);
    const retry = {label: 'Повторити', run: () => onChoose(target)};
    return (
      <ProblemScreen
        eyebrow="Роль не змінено"
        title={id ? panelTitle(id) : 'Вибір ролі'}
        problem={session.problem}
        retry={retry}
      />
    );
  }

  const profile = session.session?.profile ?? null;
  const id = panelOf(profile);
  if (!id) return <WelcomePanel disabled={props.busy} onSelect={onChoose} />;
  if (panel.state.status === 'failed') {
    const retry = {label: 'Повторити', run: () => void panel.reload().catch(() => undefined)};
    return (
      <ProblemScreen
        eyebrow={EYEBROWS[id]}
        title={panelTitle(id)}
        problem={panel.state.problem}
        retry={retry}
        extra={toRoles}
      />
    );
  }
  if (panel.state.status !== 'ready') return <LoadingPanel id={id} />;
  return <ReadyPanel {...props} data={panel.state.data} />;
}
