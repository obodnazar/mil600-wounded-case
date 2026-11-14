import {Card} from '../../components/Card';
import {Section} from '../../components/Section';
import {ExternalLink} from '../../components/ExternalLink';
import {
  CERTIFICATE_ALIAS_NOTE,
  CERTIFICATE_AUTHORSHIP_NOTE,
  CERTIFICATE_FORM_REFERENCE,
  REFERRAL_NOTE,
  REFERRAL_SIMPLIFICATION,
  OGD_AWAITS_VLK_NOTE,
  REWARD_NOTE,
  SEVERITY_PAYMENTS_NOTE,
} from '../../content/legal';

const STEPS: readonly {title: string; text: string}[] = [
  {
    title: 'Медичний документ',
    text:
      'Джерело підтверджує медичний документ і дату, коли ви його отримали. ' +
      'Від підтвердженої дати рахується строк довідки.',
  },
  {
    title: 'Довідка',
    text:
      `${CERTIFICATE_AUTHORSHIP_NOTE} ${CERTIFICATE_ALIAS_NOTE} ` +
      'Відправлення й отримання адресатом показуємо окремо.',
  },
  {
    title: 'ВЛК',
    text: `${REFERRAL_NOTE} ${REFERRAL_SIMPLIFICATION} Медичне рішення ухвалює лише ВЛК.`,
  },
  {
    title: 'Виплати',
    text:
      `${REWARD_NOTE} ${OGD_AWAITS_VLK_NOTE} ${SEVERITY_PAYMENTS_NOTE} ` +
      'Дати коштів тут не обіцяються.',
  },
];

/** Пояснення маршруту простими словами: що буде далі й хто це робить. */
export function WhatNextSection() {
  return (
    <Section id="next" eyebrow="Що буде далі" title="Ви бачите крок. Супровід веде справу." collapsible>
      <Card surface="dark" className="what-next">
        <ol className="what-next__steps">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="what-next__number" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="what-next__foot">
          Якщо вхід бійця недоступний, призначений супровід працює у своїй області.{' '}
          Форма довідки:{' '}
          <ExternalLink href={CERTIFICATE_FORM_REFERENCE.href}>{CERTIFICATE_FORM_REFERENCE.label}</ExternalLink>.
        </p>
      </Card>
    </Section>
  );
}
