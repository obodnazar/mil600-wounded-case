import type {PatientCaseView} from '../../../shared/api';
import type {CommandDraft} from '../../app/useCommand';
import {Section} from '../../components/Section';
import {PageHeader} from '../../components/PageHeader';
import {CARE_RULE, CERTIFICATE_RULE, SERVICE_RULE} from '../../content/legal';
import {DeadlineCard} from '../shared/DeadlineCard';
import {summarizeCareDeadline, summarizeCertificateDeadline} from '../shared/deadlines';
import {CaseStatusCard} from './CaseStatusCard';
import {DocumentsSection} from './DocumentsSection';
import {FactsCard} from './FactsCard';
import {FinanceSection} from './FinanceSection';
import {HelpSection} from './HelpSection';
import {NextStepCard} from './NextStepCard';
import {SectionNav} from './SectionNav';
import {TimelineSection} from './TimelineSection';
import {WhatNextSection} from './WhatNextSection';

interface PatientPanelProps {
  view: PatientCaseView;
  busy: boolean;
  onCommand: (draft: CommandDraft) => void;
}

/** Панель військовослужбовця: де кейс, що далі, хто відповідає — і докладніше нижче. */
export function PatientPanel({view, busy, onCommand}: PatientPanelProps) {
  const certificate = summarizeCertificateDeadline(view.certificateDeadline);
  return (
    <>
      <PageHeader eyebrow="Шлях після поранення" title="Мій кейс" />
      <div className="patient-top">
        <CaseStatusCard view={view} />
        <NextStepCard view={view} />
      </div>
      <SectionNav />
      <Section id="facts" eyebrow="Стан" title="Що підтверджено, а що невідомо" collapsible defaultOpen>
        <FactsCard view={view} />
      </Section>
      <Section
        id="deadlines"
        eyebrow="Строки"
        title="Строки й від чого вони рахуються"
        lead="Строк з’являється лише тоді, коли підтверджено дату, від якої його рахують."
        collapsible
        summary={certificate.status}
      >
        <div className="deadline-grid">
          <DeadlineCard rule={CERTIFICATE_RULE} summary={certificate} />
          <DeadlineCard rule={CARE_RULE} summary={summarizeCareDeadline(view.care.deadline)} />
        </div>
        <p className="section__note section__note--rule">{SERVICE_RULE}</p>
      </Section>
      <DocumentsSection view={view} busy={busy} onCommand={onCommand} />
      <FinanceSection view={view} />
      <TimelineSection view={view} />
      <WhatNextSection />
      <HelpSection view={view} busy={busy} onCommand={onCommand} />
    </>
  );
}
