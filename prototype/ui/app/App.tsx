import {useState} from 'react';
import {AppHeader} from '../components/AppHeader';
import {FeedbackDock} from '../components/FeedbackDock';
import {PanelNav} from '../components/PanelNav';
import {SessionWarning} from '../components/SessionWarning';
import {Shell} from '../components/Shell';
import {PROFILE_LABELS} from '../content/labels';
import {MainContent} from './MainContent';
import {useAppState} from './useAppState';

/** Корінь застосунку: каркас навколо основної зони, стан — у useAppState. */
export function App() {
  const {session, panel, mutation, runCommand, simulator, shell, busy, choose} = useAppState();
  const [staffCase, setStaffCase] = useState<string | null>(null);
  const {feedback} = mutation;
  const sessionReady = session.phase === 'ready';

  return (
    <Shell
      busy={shell.loading}
      header={
        <AppHeader
          roleLabel={shell.headerProfile ? PROFILE_LABELS[shell.headerProfile] : null}
          loadedAt={shell.loadedAt}
          stale={shell.stale}
          canRefresh={!busy}
          canGoHome={sessionReady && !busy && shell.shownProfile !== null}
          onRefresh={() => void mutation.refresh()}
          onHome={() => choose(null)}
        />
      }
      nav={<PanelNav active={shell.activePanel} disabled={!sessionReady || busy} onSelect={choose} />}
      dock={
        <FeedbackDock
          result={shell.activePanel === 'dev' ? null : feedback.result}
          problem={feedback.problem}
          retry={feedback.retry}
          busy={busy}
          onDismissResult={mutation.dismissResult}
          onDismissProblem={mutation.dismissProblem}
        />
      }
    >
      {session.expiringSoon && <SessionWarning onRenew={session.renew} />}
      <MainContent
        session={session}
        panel={panel}
        busy={busy}
        result={feedback.result}
        simulator={simulator}
        staffCase={staffCase}
        onStaffCase={setStaffCase}
        onChoose={choose}
        onCommand={runCommand}
      />
    </Shell>
  );
}
