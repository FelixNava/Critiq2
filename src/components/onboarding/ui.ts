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
