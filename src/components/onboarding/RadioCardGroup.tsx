"use client";

type Option = { value: string; label: string; description: string };

/**
 * A radio group rendered as selectable tiles. Each tile contains a real,
 * visible radio input (keyboard + screen-reader friendly). The selected tile
 * gets a slate border + ring. Errors are announced via an aria-live region.
 */
export default function RadioCardGroup({
  name,
  legend,
  helper,
  options,
  value,
  onChange,
  error,
}: {
  name: string;
  legend: string;
  helper?: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <fieldset>
      <legend className="text-base font-semibold text-slate-900">
        {legend}
      </legend>
      {helper && <p className="mt-1 text-sm text-slate-500">{helper}</p>}

      <div className="mt-4 space-y-2.5">
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <label
              key={opt.value}
              className={
                "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition " +
                (selected
                  ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                  : "border-slate-200 hover:border-slate-300")
              }
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={selected}
                onChange={() => onChange(opt.value)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-slate-900"
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-slate-900">
                  {opt.label}
                </span>
                <span className="mt-0.5 text-sm text-slate-500">
                  {opt.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div aria-live="polite">
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    </fieldset>
  );
}
