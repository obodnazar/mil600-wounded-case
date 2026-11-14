import {BANNER_TEXT} from '../content/panels';

/** Постійне застереження на кожному екрані. */
export function Banner() {
  return (
    <div className="training-banner" role="note">
      {BANNER_TEXT}
    </div>
  );
}
