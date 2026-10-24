"use client";

/** A labeled signal row with a switch. Controlled: parent owns `checked`. */
export function TransparencyToggle({
  label,
  value,
  checked,
  onChange,
}: {
  label: string;
  value: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-white">{label}</span>
        <span className="text-xs text-white/55">{value}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-pill transition-colors duration-200 ${
          checked ? "bg-success" : "bg-white/20"
        }`}
      >
        <span
          className={`absolute left-0 top-0.5 size-5 rounded-full bg-white transition-transform duration-200 ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
