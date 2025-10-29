import { useState } from "react";
import Link from "next/link";



export default function GuidePage() {
  // quais cards estão abertos
  const [open, setOpen] = useState([true, false, false, false, false]);

  function toggle(i) {
    setOpen((prev) => {
      const copy = [...prev];
      copy[i] = !copy[i];
      return copy;
    });
  }

  const sections = [
    {
      title: "Setup (admin)",
      body: [
        "Add @balloteer_bot to your Telegram group.",
        "In the group, send /start. The first person to do that becomes admin.",
        "The bot DMs that admin and registers the community in the database / on-chain context.",
      ],
    },
    {
      title: "Onboarding voters",
      body: [
        "Voters DM the bot and run /join. The admin receives a private approval panel with buttons:",
        "✅ Approve (1 weight)",
        "✅ Approve (custom weight)",
        "❌ Reject",
        "“Weight” = voting power. You can edit it any time later with /setweight, and you can include a reason (e.g. “core contributor”, “advisor”).",
      ],
    },
    {
      title: "Creating a proposal",
      body: [
        "As admin, DM the bot and run /new. The bot will ask:",
        "• Title of the vote",
        "• Options (comma separated)",
        "• Quorum (minimum total weight to make vote valid)",
        "• Duration in minutes (auto-close timer)",
        "• Optional PDF/attachment for context",
        "When you publish, the bot:",
        "• Posts “Voting is open” in the group",
        "• DMs every approved voter privately with their ballot buttons",
        "• Starts tracking all weights off-chain",
      ],
    },
    {
      title: "Voting (private)",
      body: [
        "Voters never vote in the group chat. They vote in DM by tapping an option button.",
        "They can change their vote any time before the deadline using /myvote.",
        "The group never sees who picked what. Only the final totals.",
      ],
    },
    {
      title: "Closing + Result",
      body: [
        "When the timer expires (or you run /close manually), the bot:",
        "• Closes the proposal",
        "• Posts final weighted results in the group",
        "• Shows whether quorum was reached",
        "• Handles ties and “no votes” cases",
        "Roadmap: wallet binding, zk weight proofs, and on-chain finalization on Solana — but you can already run real governance in Telegram today.",
      ],
    },
  ];

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10 md:px-10 lg:px-24 font-sans">
      {/* topo / voltar */}
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-zinc-400 hover:text-white transition-colors mb-6"
        >
          <span className="mr-2">←</span>
          <span>Back</span>
        </Link>

        <div className="absolute inset-0 bg-noise-overlay pointer-events-none" />
        <div className="absolute inset-0 bg-radial-fade pointer-events-none" />
        <div className="absolute inset-0 animate-clouds pointer-events-none opacity-[0.4]" />


        {/* header */}
        <h1 className="text-2xl md:text-3xl font-semibold text-white">
          Balloteer Guide
        </h1>
        <p className="text-base md:text-lg text-zinc-400 mt-2 leading-relaxed">
          Admins propose. Voters get private ballots in DM. The group only sees
          the final result, with quorum check.
        </p>

        {/* tags */}
        <div className="flex flex-wrap gap-2 mt-5">
          {["Weighted votes", "Anonymous", "Quorum required", "Final result posted"].map(
            (tag) => (
              <div
                key={tag}
                className="rounded-full bg-zinc-900 border border-zinc-700 text-xs text-zinc-300 px-3 py-1"
              >
                {tag}
              </div>
            )
          )}
        </div>

        {/* acordeões */}
        <div className="mt-8 space-y-4">
          {sections.map((section, i) => (
            <div
              key={i}
              className="rounded-2xl bg-zinc-950 border border-zinc-800 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)] overflow-hidden"
            >
              {/* header do card */}
              <button
                onClick={() => toggle(i)}
                className="w-full flex items-start justify-between gap-4 text-left px-4 py-4 md:px-6 md:py-5 hover:bg-zinc-900 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center text-xs font-medium text-white bg-zinc-800 rounded-full w-7 h-7 border border-zinc-700">
                    {i + 1}
                  </div>
                  <div>
                    <div className="text-white font-medium text-base md:text-lg">
                      {section.title}
                    </div>
                  </div>
                </div>

                <div className="text-zinc-500 text-xs md:text-sm whitespace-nowrap">
                  {open[i] ? "Hide ▲" : "Show ▼"}
                </div>
              </button>

              {/* corpo expandido */}
              {open[i] && (
                <div className="px-4 pb-5 md:px-6 md:pb-6 text-sm md:text-base text-zinc-300 leading-relaxed border-t border-zinc-800">
                  {section.body.map((line, j) => (
                    <p key={j} className="mt-3 first:mt-0">
                      {line}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* footer */}
        <footer className="text-xs text-zinc-600 mt-10 mb-16">
          Balloteer © 2025
        </footer>
      </div>
    </main>
  );
}
