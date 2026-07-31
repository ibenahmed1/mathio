// Illustration "livraison & logistique" (avion, globe, entrepôt, chariot
// élévateur) recréée dans la palette de marque — même composition que le
// visuel de référence, dessinée en interne (monoline jaune/noir) plutôt que
// reprise telle quelle.
export function SidebarIllustration() {
  return (
    <svg viewBox="0 0 300 230" fill="none" xmlns="http://www.w3.org/2000/svg" className="mx-auto h-auto w-[70%]">
      {/* Globe */}
      <g>
        <clipPath id="globeClip">
          <circle cx="205" cy="64" r="48" />
        </clipPath>
        <circle cx="205" cy="64" r="48" className="fill-white stroke-black dark:fill-white/10" strokeWidth="2.5" />
        <g clipPath="url(#globeClip)" className="fill-brand">
          <path d="M158 40c14-10 26 4 40-2s24-10 36 0 18 26 4 34-30-6-42 2-30 4-38-8-12-18 0-26Z" />
          <path d="M172 96c10-6 20 2 30-4s16 10 6 16-24-2-30 4-14-10-6-16Z" />
        </g>
        <circle cx="205" cy="64" r="48" className="stroke-black dark:stroke-white/40" strokeWidth="2.5" fill="none" />
      </g>

      {/* Trajet en pointillés + pins */}
      <path
        d="M182 44c22-6 42 2 56 10"
        className="stroke-black dark:stroke-white/60"
        strokeWidth="2"
        strokeDasharray="4 5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M232 52l7 3-3 7" className="stroke-black dark:stroke-white/60" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <g className="fill-brand stroke-black dark:stroke-white/60" strokeWidth="2">
        <circle cx="182" cy="44" r="6" />
        <circle cx="182" cy="44" r="2" className="fill-white" />
      </g>
      <g className="fill-brand stroke-black dark:stroke-white/60" strokeWidth="2">
        <circle cx="243" cy="92" r="6" />
        <circle cx="243" cy="92" r="2" className="fill-white" />
      </g>

      {/* Avion */}
      <g transform="translate(16,44) rotate(-14)">
        <path
          d="M35 15 18 42 30 42 54 16Z"
          className="fill-brand stroke-black dark:stroke-white/70"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path
          d="M0 10 14 3 86 3Q99 3 108 10Q99 17 86 17L14 17Z"
          className="fill-brand stroke-black dark:stroke-white/70"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path
          d="M88 4 97-13 103 4Z"
          className="fill-brand stroke-black dark:stroke-white/70"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M18 10h20" className="stroke-black/50 dark:stroke-white/30" strokeWidth="1.5" />
      </g>

      {/* Accents */}
      <path d="M12 32l4 4m0-4l-4 4" className="stroke-black dark:stroke-white/50" strokeWidth="2" strokeLinecap="round" />
      <circle cx="62" cy="22" r="2.5" className="fill-brand stroke-black dark:stroke-white/50" strokeWidth="1.5" />
      <path d="M268 130c6 10 6 22 0 34M280 126c8 12 8 30 0 44" className="stroke-black/25 dark:stroke-white/20" strokeWidth="2" strokeLinecap="round" fill="none" />

      {/* Sol */}
      <line x1="6" y1="206" x2="294" y2="206" className="stroke-black/20 dark:stroke-white/15" strokeWidth="2" />

      {/* Camion (tronqué à gauche) */}
      <g className="stroke-black dark:stroke-white/50" strokeWidth="2" strokeLinejoin="round">
        <rect x="-10" y="150" width="34" height="34" rx="2" className="fill-white dark:fill-white/10" />
        <path d="M24 164h16l8 10v10H24z" className="fill-brand" />
        <circle cx="8" cy="188" r="7" className="fill-white dark:fill-white/10" />
        <circle cx="38" cy="188" r="7" className="fill-white dark:fill-white/10" />
      </g>

      {/* Étagère de cartons */}
      <g className="stroke-black dark:stroke-white/60" strokeWidth="2.5" strokeLinejoin="round">
        <path d="M74 108v76M74 108l16-10h70l16 10M176 108v76" className="fill-none" />
        <path d="M74 184h102l-14 14H88z" className="fill-brand" />
      </g>
      <g className="stroke-black/70 dark:stroke-white/40" strokeWidth="1.5">
        <line x1="74" y1="132" x2="176" y2="132" />
        <line x1="74" y1="158" x2="176" y2="158" />
        <line x1="108" y1="108" x2="108" y2="184" />
        <line x1="142" y1="108" x2="142" y2="184" />
      </g>
      <g className="fill-white stroke-black/60 dark:fill-white/10 dark:stroke-white/30" strokeWidth="1.5">
        <rect x="80" y="112" width="22" height="16" rx="1.5" />
        <rect x="114" y="112" width="22" height="16" rx="1.5" className="fill-brand" />
        <rect x="148" y="112" width="22" height="16" rx="1.5" />
        <rect x="80" y="138" width="22" height="16" rx="1.5" className="fill-brand" />
        <rect x="114" y="138" width="22" height="16" rx="1.5" />
        <rect x="148" y="138" width="22" height="16" rx="1.5" className="fill-brand" />
      </g>

      {/* Chariot élévateur */}
      <g className="stroke-black dark:stroke-white/60" strokeWidth="2.5" strokeLinejoin="round">
        <path d="M198 176h34l14-16h10v34h-58z" className="fill-brand" />
        <path d="M212 176v-24l-10-8" className="fill-none" />
        <rect x="256" y="146" width="4" height="48" className="fill-black dark:fill-white/60" strokeWidth="0" />
        <path d="M260 182h26M260 190h26" className="stroke-black dark:stroke-white/60" strokeWidth="2.5" />
        <rect x="266" y="158" width="24" height="24" rx="1.5" className="fill-white dark:fill-white/10" />
        <rect x="222" y="160" width="30" height="24" rx="1.5" className="fill-white dark:fill-white/10" />
        <circle cx="210" cy="204" r="10" className="fill-white dark:fill-white/10" />
        <circle cx="246" cy="204" r="10" className="fill-white dark:fill-white/10" />
        <circle cx="210" cy="204" r="3" className="fill-black dark:fill-white/60" strokeWidth="0" />
        <circle cx="246" cy="204" r="3" className="fill-black dark:fill-white/60" strokeWidth="0" />
      </g>
    </svg>
  );
}
