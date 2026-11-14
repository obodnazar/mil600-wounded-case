import type {DemoProfile} from '../../shared/api';
import type {IconName} from '../components/Icon';

export const BANNER_TEXT = 'Навчальний прототип KSE. Не офіційний сервіс Міноборони. Дані вигадані';
export const PRODUCT_NAME = 'Кейс поранення';
export const PRODUCT_NOTE = 'Навчальний концепт · KSE MIL600';

export type PanelId = 'patient' | 'staff' | 'analytics' | 'dev';

export interface PanelInfo {
  id: PanelId;
  /** Короткий підпис у навігації. */
  label: string;
  /** Заголовок сторінки панелі. */
  title: string;
  /** Навчальна роль, з якою панель відкривається з навігації. */
  profile: DemoProfile;
  icon: IconName;
  audience: string;
  description: string;
}

export const PANELS: readonly PanelInfo[] = [
  {
    id: 'patient',
    label: 'Мій кейс',
    title: 'Мій кейс',
    profile: 'patient',
    icon: 'case',
    audience: 'Військовослужбовець',
    description: 'Де зараз кейс, що далі й хто відповідальний. Документи, строки та виплати — окремо.',
  },
  {
    id: 'staff',
    label: 'Супровід',
    title: 'Супровід кейсів',
    profile: 'support',
    icon: 'people',
    audience: 'Супровід і командир',
    description: 'Призначені кейси, відкриті задачі, звірки та дії з поясненням, чому вони доступні чи ні.',
  },
  {
    id: 'analytics',
    label: 'Аналітика',
    title: 'Огляд процесу',
    profile: 'analyst',
    icon: 'chart',
    audience: 'Аналітик',
    description: 'Шість показників на фіксованій вигаданій когорті. Малі групи приховано.',
  },
  {
    id: 'dev',
    label: 'Симулятор',
    title: 'Симулятор джерел',
    profile: 'dev',
    icon: 'code',
    audience: 'Розробник',
    description: 'Навчальні події джерел, повтор і конфлікт. Єдине місце з технічними деталями.',
  },
];

const PROFILE_PANELS: Record<DemoProfile, PanelId> = {
  patient: 'patient',
  support: 'staff',
  commander: 'staff',
  analyst: 'analytics',
  dev: 'dev',
};

export function panelOf(profile: DemoProfile | null): PanelId | null {
  return profile ? PROFILE_PANELS[profile] : null;
}
