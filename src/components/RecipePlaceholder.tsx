/**
 * What stands where a recipe has no picture: a calm, pale tile with a camera icon, in the same 16:10 box as a picture
 * (the card grid does not jump). One look for every recipe, in the light and the dark scheme; the colours are in
 * globals.css (.ph). Plain inline SVG: no image, no font, no request. It is decoration only: the name is already the
 * text of the card, so the tile is hidden from screen readers.
 */
export function RecipePlaceholder() {
  return (
    <div className="ph" aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false" aria-hidden="true">
        <rect x="5" y="13" width="38" height="27" rx="4" />
        <path d="M16 13l2.5-5h11L32 13" />
        <circle cx="24" cy="26.5" r="8.5" />
        <circle cx="24" cy="26.5" r="3.5" />
        <circle cx="37" cy="19.5" r="1" />
      </svg>
    </div>
  );
}
