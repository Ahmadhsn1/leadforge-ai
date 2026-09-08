import { ImageResponse } from 'next/og';

/**
 * The card that renders when a LeadForge link is shared.
 *
 * Generated rather than a checked-in PNG so the mark, the palette and the
 * tagline cannot drift away from the app. Sizes and colours are literal here
 * because Satori resolves no CSS variables and no Tailwind — it only sees the
 * inline styles on these elements.
 */
export const alt = 'LeadForge AI — Find the right businesses. Understand them.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#0A0B0F';
const BLUE = '#3B82F6';
const CYAN = '#06B6D4';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: INK,
        padding: 72,
        fontFamily: 'sans-serif',
        position: 'relative',
      }}
    >
      {/* A single soft accent bloom, echoing the app's dark surfaces. */}
      <div
        style={{
          position: 'absolute',
          top: -260,
          right: -180,
          width: 760,
          height: 760,
          borderRadius: 760,
          background: `radial-gradient(circle, ${BLUE}38 0%, ${INK}00 68%)`,
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <svg width="72" height="72" viewBox="0 0 32 32">
          <defs>
            <linearGradient id="og" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor={BLUE} />
              <stop offset="1" stopColor={CYAN} />
            </linearGradient>
          </defs>
          <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#og)" />
          <path
            d="M10.2 8.8 16 15.2l5.8-6.4"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.72"
          />
          <path d="M16 17.6 19.4 21 16 24.4 12.6 21z" fill="#fff" />
        </svg>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 44, fontWeight: 700, color: '#fff', letterSpacing: -1 }}>
            LeadForge
          </span>
          {/* Satori baseline-aligns by font box, which drops the smaller word well
              below the wordmark. Lifting it optically re-centres the pair. */}
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: BLUE,
              letterSpacing: 3,
              transform: 'translateY(-16px)',
            }}
          >
            AI
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          style={{
            fontSize: 66,
            fontWeight: 700,
            color: '#fff',
            letterSpacing: -2,
            lineHeight: 1.08,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <span>Find the right businesses.</span>
          <span>Understand them.</span>
        </div>
        <div style={{ fontSize: 27, color: '#9BA3B4', lineHeight: 1.4, maxWidth: 900 }}>
          Every recommendation cites the evidence behind it.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        {['Evidence-backed', 'Deterministic scoring', 'You approve every send'].map((tag) => (
          <div
            key={tag}
            style={{
              display: 'flex',
              fontSize: 21,
              color: '#C7CEDB',
              border: '1px solid #262A35',
              borderRadius: 999,
              padding: '10px 22px',
              background: '#12141B',
            }}
          >
            {tag}
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
