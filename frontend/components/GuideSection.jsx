// components/GuideSection.jsx
"use client";
import { useState } from "react";

export default function GuideSection({
  number,
  title,
  children,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 backdrop-blur-sm mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-3 p-4 text-left"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800 text-[13px] font-medium text-zinc-200 border border-zinc-700/60">
          {number}
        </span>

        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h2 className="text-zinc-100 font-semibold text-base">{title}</h2>
            <span className="text-zinc-500 text-xs">
              {open ? "Hide ▲" : "Show ▼"}
            </span>
          </div>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-0 text-[14px] leading-relaxed text-zinc-300 border-t border-zinc-800/60">
          {children}
        </div>
      )}
    </section>
  );
}
