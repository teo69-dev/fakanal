import { initialOf, paletteOf, patternOf } from "@/lib/placeholder";

// The faint drawings behind the letter: a plate with a fork and a knife, soft circles, waves. Plain SVG strokes, drawn in
// the colour of the letter at low opacity (see .ph-art in globals.css).
const ART = [
  <g key="plate">
    <circle cx="80" cy="50" r="30" />
    <circle cx="80" cy="50" r="20" />
    <path d="M24 22v16a5 5 0 0 0 10 0V22M29 22v56" />
    <path d="M134 22c-8 9-8 27 0 35v21" />
  </g>,
  <g key="circles">
    <circle cx="28" cy="74" r="26" />
    <circle cx="124" cy="22" r="32" />
    <circle cx="146" cy="86" r="14" />
    <circle cx="66" cy="16" r="9" />
  </g>,
  <g key="waves">
    <path d="M-4 66q22-16 44 0t44 0 44 0 44 0" />
    <path d="M-4 82q22-16 44 0t44 0 44 0 44 0" />
    <path d="M-4 34q22-16 44 0t44 0 44 0 44 0" />
  </g>,
];

/**
 * A tile for a recipe without a picture, the same size as a picture would be (the card grid does not jump), or, as a
 * "banner", a slim strip for the top of the recipe page. It is decoration: the name is already in the page as text, so
 * the tile is hidden from screen readers.
 */
export function RecipePlaceholder({ slug, name, variant = "card" }: { slug: string; name: string; variant?: "card" | "banner" }) {
  return (
    <div className={`ph ph-${paletteOf(slug)} ph-${variant}`} aria-hidden="true">
      <svg className="ph-art" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" focusable="false" aria-hidden="true">
        {ART[patternOf(slug)]}
      </svg>
      <span className="ph-letter">{initialOf(name)}</span>
    </div>
  );
}
