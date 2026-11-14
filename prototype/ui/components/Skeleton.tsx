export type SkeletonLayout = 'patient' | 'staff' | 'analytics' | 'dev' | 'welcome';

const BLOCKS: Record<SkeletonLayout, readonly string[]> = {
  patient: ['wide tall', 'narrow tall', 'wide', 'narrow', 'full'],
  staff: ['narrow tall', 'wide tall', 'full'],
  analytics: ['full', 'third', 'third', 'third', 'third', 'third', 'third'],
  dev: ['wide tall', 'narrow tall', 'full'],
  welcome: ['full tall', 'half', 'half'],
};

interface SkeletonProps {
  layout: SkeletonLayout;
  label?: string;
}

/** Заглушка завантаження у формі майбутнього екрана. */
export function Skeleton({layout, label = 'Завантажуємо навчальні дані…'}: SkeletonProps) {
  return (
    <div className="skeleton-grid" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {BLOCKS[layout].map((shape, index) => (
        <div key={index} className={`skeleton ${shape}`} aria-hidden="true">
          <span className="skeleton__line skeleton__line--short" />
          <span className="skeleton__line skeleton__line--title" />
          <span className="skeleton__line" />
          <span className="skeleton__line skeleton__line--mid" />
        </div>
      ))}
    </div>
  );
}
