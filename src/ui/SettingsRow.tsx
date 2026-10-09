/**
 * The pieces every settings page is built from: a titled row, and an Off / On switch. Shared so the
 * pages read as one panel rather than six.
 */
import type { ReactNode } from "react";
import { Segmented } from "./controls/Segmented";

export function SettingsRow({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">{title}</span>
      {children}
      {hint && <p className="text-[11px] text-faint leading-relaxed">{hint}</p>}
    </div>
  );
}

export function OnOff({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Segmented
      label={label}
      options={[
        { value: "off", label: "Off" },
        { value: "on", label: "On" },
      ]}
      value={on ? "on" : "off"}
      onChange={(value) => onChange(value === "on")}
      className="self-start"
    />
  );
}
