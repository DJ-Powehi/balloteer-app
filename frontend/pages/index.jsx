import Link from "next/link";

function ComparisonCard() {
  return (
    <div
      className="
        hidden
        lg:flex
        flex-col
        text-[13px]
        leading-relaxed
        text-white/80
        rounded-xl
        border border-white/10
        bg-white/5
        backdrop-blur-[12px]
        shadow-[0_30px_120px_rgba(0,0,0,0.8)]
        shadow-[0_30px_120px_rgba(0,0,0,0.8)]
        min-w-[260px]
        max-w-[280px]
        pointer-events-none
        "
      style={{
        boxShadow:
          "0 40px 160px rgba(0,0,0,0.9), 0 0 120px rgba(0,229,255,0.18)",
      }}
    >
      {/* header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-[12px] uppercase tracking-wide text-white/50 font-medium">
        <span>Traditional</span>
        <span className="text-white/30">vs</span>
        <span className="text-white/90">Balloteer</span>
      </div>

      {/* rows */}
      <div className="flex flex-col px-4 py-3 gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="text-white/60">
            <span className="block font-medium text-white/80">10 minutes</span>
            <span className="block text-[12px] text-white/40">
              manual tally
            </span>
          </div>
          <div className="text-right">
            <span className="block font-medium text-emerald-400">
              5 seconds
            </span>
            <span className="block text-[12px] text-white/40">
              instant DM poll
            </span>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="text-white/60">
            <span className="block font-medium text-white/80">Need wallet</span>
            <span className="block text-[12px] text-white/40">
              onboards slow
            </span>
          </div>
          <div className="text-right">
            <span className="block font-medium text-emerald-400">
              Just Telegram
            </span>
            <span className="block text-[12px] text-white/40">
              no crypto req
            </span>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="text-white/60">
            <span className="block font-medium text-white/80">
              Public votes
            </span>
            <span className="block text-[12px] text-white/40">
              group pressure
            </span>
          </div>
          <div className="text-right">
            <span className="block font-medium text-emerald-400">
              Private DMs
            </span>
            <span className="block text-[12px] text-white/40">
              anonymous weight
            </span>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="text-white/60">
            <span className="block font-medium text-white/80">
              No proof
            </span>
            <span className="block text-[12px] text-white/40">
              trust me bro
            </span>
          </div>
          <div className="text-right">
            <span className="block font-medium text-emerald-400">
              On-chain
            </span>
            <span className="block text-[12px] text-white/40">
              verifiable final
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}


export default function HomePage() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-black text-white">
      {/* glow atrás da comparação */}
      <div
        className="
          pointer-events-none
          absolute
          left-1/2
          top-[260px]
          -translate-x-[10%]
          h-[260px]
          w-[260px]
          rounded-full
          bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.18)_0%,rgba(0,0,0,0)_70%)]
          blur-[60px]
          opacity-50
          lg:opacity-80
          z-[5]
        "
      />

      {/* === BACKGROUND STACK (ordem importa) === */}
      {/* camada base azul/preta */}
      <div className="app-bg-base" />

      {/* fumaça azul escura animando devagar */}
      <div className="smoke-layer" />

      {/* vinheta escura nas bordas */}
      <div className="vignette-overlay" />

      {/* grão leve */}
      <div className="grain-overlay" />

      {/* glow azul principal atrás do hero text/botões */}
      <div className="hero-spot" />

      <div className="hero-streak" />

      <div className="right-beam" />

      <div className="right-halo" />

      <div className="hero-particles" />

      {/* comparação “Traditional vs Balloteer” */}
      <div
        className="
          absolute
          left-1/2
          top-[40vh]
          -translate-x-[10%]
          -translate-y-1/2
          z-[30]
        "
      >
        <ComparisonCard />
      </div>


      {/* === TOP RIGHT BADGE === */}
      <header className="absolute top-6 right-6 flex items-center gap-2 z-[10]">
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-400 via-sky-400 to-blue-600 shadow-[0_10px_40px_rgba(56,189,248,0.4)] flex items-center justify-center text-[10px] font-semibold text-black">
          B
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white/90 tracking-[-0.03em]">
            Balloteer
          </span>
          <span className="text-[10px] leading-none px-2 py-1 rounded-full bg-white/10 border border-white/20 text-white/60 font-medium">
            beta
          </span>
        </div>
      </header>

      {/* === LEFT HERO CONTENT === */}
      <section className="relative z-[10] max-w-xl pt-28 px-6 sm:px-12">
        <h1
          className="text-[2.5rem] sm:text-[3rem] leading-[1.05] tracking-[-0.06em] text-white drop-shadow-[0_30px_80px_rgba(0,0,0,0.9)]"
          style={{
            fontFamily:
              '"Space Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Inter", "Roboto", "Helvetica Neue", Arial, sans-serif',
            fontWeight: 600,
          }}
        >
          BALLOTEER
        </h1>





        <h2 className="mt-6 text-[1.5rem] sm:text-[1.9rem] font-medium leading-tight tracking-[-0.04em] text-white/90">
          Private on-chain governance,
          <br />
          inside your Telegram group.
        </h2>

        <p className="mt-6 text-[15px] leading-relaxed text-white/70">
          Weighted, anonymous voting with quorum and deadlines.
          Members vote privately in DM. Only the final result is posted.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <a
            href="https://t.me/balloteer_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="
              group relative inline-flex items-center justify-center
              rounded-xl px-4 py-3 text-sm font-medium
              bg-gradient-to-r from-indigo-500 via-blue-500 to-sky-400
              text-white shadow-[0_25px_80px_rgba(56,189,248,0.5)]
              hover:shadow-[0_35px_100px_rgba(56,189,248,0.7)]
              transition-shadow duration-300
            "
          >
            <span
              className="absolute inset-0 rounded-xl bg-white/30 blur-xl opacity-0 group-hover:opacity-40 transition-opacity duration-300"
              aria-hidden="true"
            />
            <span className="relative flex items-center gap-2 z-10">
              <span role="img" aria-label="rocket">
                🚀
              </span>
              <span>Launch Telegram Bot</span>
            </span>
          </a>

          <Link
            href="/guide"
            className="
              relative inline-flex items-center justify-center gap-2
              rounded-xl border border-white/20 bg-white/5
              px-4 py-3 text-sm font-medium text-white/80
              hover:bg-white/10 hover:border-white/30 hover:text-white
              transition
            "
          >
            <span>How it works</span>
            <span
              aria-hidden="true"
              className="text-white/50 group-hover:text-white"
            >
              →
            </span>
          </Link>
        </div>

        {/* tagline + footnote */}
        <p className="mt-16 text-[13px] text-white/50 leading-relaxed">
          Built for everyone — no crypto knowledge required.
        </p>

        <footer className="mt-6 text-[12px] text-white/40">
          Balloteer © 2025
        </footer>
      </section>

      {/* === RIGHT PREVIEW CARD (DESKTOP ONLY) === */}
      <aside
        className="
          hidden lg:block
          absolute right-6 top-28
          z-[10]
          w-[360px] rounded-xl border border-white/[0.07]
          bg-white/[0.03] backdrop-blur-xl
          shadow-[0_30px_120px_-10px_rgba(0,0,0,0.9)]
          p-5 text-white
        "
      >
        {/* Aura atrás do card */}
        <div className="pointer-events-none absolute -inset-0.5 rounded-xl bg-gradient-to-br from-sky-500/20 via-blue-600/10 to-transparent blur-2xl" />

        {/* Header mini */}
        <div className="relative mb-4 flex items-center gap-2 text-[11px] text-white/50 font-mono">
          <span className="px-2 py-0.5 rounded bg-white/10 border border-white/20 text-white/70">
            live vote preview
          </span>
          <span className="text-white/30">• DM ballots</span>
        </div>

        {/* Proposal header */}
        <div className="relative flex items-start justify-between mb-4">
          <div>
            <div className="text-[11px] text-white/40 font-mono tracking-tight">
              Proposal #12 · OPEN
            </div>
            <div className="text-[15px] font-medium text-white leading-snug">
              Fund community marketing for Q1?
            </div>
          </div>

          <div className="text-right leading-tight">
            <div className="text-[11px] text-white/40 font-mono">
              time&nbsp;&nbsp;left
            </div>
            <div className="text-[13px] text-white font-medium">42m</div>
          </div>
        </div>

        {/* Quorum bar */}
        <div className="relative rounded-lg border border-white/10 bg-white/[0.02] p-3 mb-3">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-white/80">Quorum reached</span>
            <span className="text-emerald-400 font-medium">61%</span>
          </div>
          <div className="mt-2 h-1.5 rounded bg-white/5 overflow-hidden">
            <div className="h-full w-[61%] bg-gradient-to-r from-emerald-400 to-emerald-600" />
          </div>
        </div>

        {/* Options */}
        <div className="relative space-y-2 text-[13px]">
          {[
            { label: "Increase budget", weight: "58%" },
            { label: "Keep same", weight: "33%" },
            { label: "Pause spend", weight: "9%" },
          ].map((opt, i) => (
            <div
              key={i}
              className="flex items-start justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
            >
              <div className="text-white">
                {opt.label}
                <div className="text-[11px] text-white/40 font-mono">
                  anon weight: {opt.weight}
                </div>
              </div>
              <button
                className="
                  text-[12px] px-2 py-1 rounded
                  border border-white/20 text-white/50 bg-white/[0.07]
                  cursor-default
                "
              >
                Vote
              </button>
            </div>
          ))}
        </div>

        {/* Footer legend */}
        <div className="relative border-t border-white/5 pt-3 mt-4 flex items-center justify-between text-[11px] text-white/40 font-mono">
          <span>ballots stay private</span>
          <span>group sees final result →</span>
        </div>
      </aside>
    </main>
  );
}
