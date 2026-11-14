import {useState} from 'react';
import type {DevView} from '../../../shared/api';
import type {SimulatorController} from '../../app/useSimulator';
import {Card} from '../../components/Card';
import {Section} from '../../components/Section';
import {EmptyState} from '../../components/EmptyState';
import {PageHeader} from '../../components/PageHeader';
import {DemoPath} from './DemoPath';
import {GatewayCard, RecentLog, SnapshotSwitch, StatsGrid} from './DevSidebar';
import {SimulatorCard} from './SimulatorCard';

interface DevPanelProps {
  view: DevView;
  busy: boolean;
  /** Останній підтверджений сервером результат. */
  result: string | null;
  simulator: SimulatorController;
}

/** Dev-симулятор: єдине місце з технічними деталями обробки подій. */
export function DevPanel({view, busy, result, simulator}: DevPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = view.fixtures.find(fixture => fixture.id === selectedId) ?? view.fixtures[0];
  const select = (id: string) => {
    setSelectedId(id);
    document.getElementById('simulator-title')?.scrollIntoView({block: 'start'});
  };

  return (
    <>
      <PageHeader
        eyebrow="Лише навчальні події"
        title="Симулятор джерел"
        lead="Фіксовані вигадані події проходять той самий шлюз, що й зовнішнє джерело."
      />
      <div className="dev-grid">
        {selected ? (
          <SimulatorCard
            fixtures={view.fixtures}
            selected={selected}
            sent={simulator.sent}
            busy={busy}
            result={result}
            outcome={simulator.outcome}
            onSelect={setSelectedId}
            onSend={mode => simulator.sendEvent(selected.id, mode)}
          />
        ) : (
          <Card>
            <EmptyState icon="code" title="Навчальних подій немає">
              Сервер не передав жодної події для симулятора.
            </EmptyState>
          </Card>
        )}
        <div className="dev-grid__side">
          <GatewayCard />
          <StatsGrid stats={view.stats} />
        </div>
      </div>
      {selected && (
        <Section id="d1-path" eyebrow="D1 · порядок показу" title="Мінімальний демо-шлях">
          <Card>
            <DemoPath
              fixtures={view.fixtures}
              selectedId={selected.id}
              sent={simulator.sent}
              onSelect={select}
              onClearSent={simulator.clearSent}
            />
          </Card>
        </Section>
      )}
      <Section id="recent" eyebrow="Inbox" title="Останні прийняті події">
        <Card>
          <RecentLog recent={view.recent} />
        </Card>
      </Section>
      <Section
        id="snapshots"
        eyebrow="Захист агрегатів"
        title="Фіксовані зрізи аналітики"
        lead="Малий зріз потрібен, щоб перевірити приховування малих і доповнювальних груп."
      >
        <Card>
          <SnapshotSwitch current={view.analyticsSnapshot} busy={busy} onSelect={simulator.selectSnapshot} />
        </Card>
      </Section>
      <p className="page-footnote">
        Власний навчальний контракт. Справжніх API МІС ЗСУ чи ЕСОЗ, медичних даних та інтеграцій немає.
      </p>
    </>
  );
}
