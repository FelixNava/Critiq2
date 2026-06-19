/**
 * Shared Tailwind class constants for the onboarding flow. Mirrors the look of
 * the auth pages (slate palette) so the whole signed-out → onboarding journey
 * feels consistent. Plain strings — no runtime cost, no dependencies.
 */

export const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900";

export const textareaClass =
  inputClass + " min-h-[88px] resize-none leading-relaxed";

export const buttonClass =
  "w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50";

export const secondaryButtonClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50";

export const cardClass =
  "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8";

// Inline (auto-width) button variants for rows/cards where a full-width button
// would be wrong (e.g. side-by-side actions). 44px min-height = a comfortable
// touch target on a phone (reps act on these surfaces on mobile).
export const inlineButtonClass =
  "inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:opacity-50";

export const inlineSecondaryButtonClass =
  "inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:opacity-50";

// Inputs sized to avoid iOS Safari auto-zoom (16px on phones, 14px on desktop)
// for the mobile-first recording surfaces.
export const mobileInputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 sm:text-sm";
