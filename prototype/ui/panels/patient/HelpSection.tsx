import type {PatientCaseView} from '../../../shared/api';
import type {CommandDraft} from '../../app/useCommand';
import {Button} from '../../components/Button';
import {Card} from '../../components/Card';
import {Section} from '../../components/Section';
import {RequestList} from '../shared/CaseBits';
import {GuideCard} from '../shared/GuideCard';

interface HelpSectionProps {
  view: PatientCaseView;
  busy: boolean;
  onCommand: (draft: CommandDraft) => void;
}

/** Допомога: звернення до супроводу, стан звернень і гайд без входу. */
export function HelpSection({view, busy, onCommand}: HelpSectionProps) {
  return (
    <Section
      id="help"
      eyebrow="Допомога"
      title="Як отримати допомогу"
      lead="Якщо щось незрозуміло — попросіть уточнення. Супровід бачить ваш кейс у своїй області."
      collapsible
      defaultOpen
    >
      <div className="help-grid">
        <Card as="article" className="help-request">
          <h3>Звернення до супроводу</h3>
          <p>
            Звернення реєструється в кейсі й призначається службі супроводу. Вам не треба пояснювати все
            заново: супровід бачить наступний крок і відкриті задачі.
          </p>
          <Button
            variant="primary"
            icon="message"
            disabled={busy}
            onClick={() => onCommand({caseId: view.id, action: 'support_request'})}
          >
            Попросити уточнення
          </Button>
          <h4 className="help-request__subtitle">Ваші звернення</h4>
          {view.requests.length > 0 ? (
            <RequestList requests={view.requests} />
          ) : (
            <p className="muted">Звернень ще не було.</p>
          )}
          <p className="card__note">
            Родинний зв’язок сам по собі не дає доступу до кейсу. Звернення родини супровід реєструє
            окремо, і нового доступу воно не створює.
          </p>
        </Card>
        <GuideCard />
      </div>
    </Section>
  );
}
