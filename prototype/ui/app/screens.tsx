import type {ReactNode} from 'react';
import {Button} from '../components/Button';
import {Card} from '../components/Card';
import {Icon} from '../components/Icon';
import {PageHeader} from '../components/PageHeader';
import {ProblemNotice, type RetryAction} from '../components/ProblemNotice';
import type {Problem} from '../content/errors';

interface SessionEndedProps {
  onRestart: () => void;
}

/** Сесія завершилась (401 або сплив часу): дані попередньої ролі з екрана прибрано. */
export function SessionEndedScreen({onRestart}: SessionEndedProps) {
  return (
    <Card className="state-screen">
      <span className="state-screen__icon">
        <Icon name="clock" size={28} />
      </span>
      <h1>Сесія завершилась</h1>
      <p role="alert">
        Час навчальної сесії сплив або доступ відкликано. Дані попередньої ролі прибрано з екрана. Записані
        раніше дії збережено на сервері.
      </p>
      <Button variant="primary" icon="refresh" onClick={onRestart}>
        Почати нову сесію
      </Button>
    </Card>
  );
}

interface ProblemScreenProps {
  eyebrow: string;
  title: string;
  problem: Problem;
  retry: RetryAction | null;
  /** Додаткова дія (наприклад, повернутися до вибору ролі). */
  extra?: ReactNode;
}

/** Екран не вдалося показати: пояснення й повтор. Даних іншої ролі тут немає. */
export function ProblemScreen({eyebrow, title, problem, retry, extra}: ProblemScreenProps) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} />
      <ProblemNotice problem={problem} retry={retry} extra={extra} className="notice--screen" />
    </>
  );
}
