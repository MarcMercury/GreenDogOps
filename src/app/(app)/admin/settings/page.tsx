import { createAdminClient } from "@/lib/supabase/admin";
import { Panel } from "../_components";
import { updateSettings } from "../actions";

export const dynamic = "force-dynamic";

interface Setting {
  key: string;
  value: unknown;
  category: string;
  label: string | null;
  description: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  security: "Security",
  features: "Features",
};

function SettingField({ s }: { s: Setting }) {
  const label = s.label ?? s.key;
  const common =
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100";

  let control: React.ReactNode;
  if (typeof s.value === "boolean") {
    control = (
      <select
        name={`setting_${s.key}`}
        defaultValue={String(s.value)}
        className={`${common} bg-white`}
      >
        <option value="true">Enabled</option>
        <option value="false">Disabled</option>
      </select>
    );
  } else if (Array.isArray(s.value)) {
    control = (
      <input
        name={`settingarr_${s.key}`}
        defaultValue={(s.value as unknown[]).join(", ")}
        placeholder="comma, separated, values"
        className={common}
      />
    );
  } else if (typeof s.value === "number") {
    control = (
      <input
        type="number"
        name={`setting_${s.key}`}
        defaultValue={s.value}
        className={common}
      />
    );
  } else {
    control = (
      <input
        name={`setting_${s.key}`}
        defaultValue={s.value == null ? "" : String(s.value)}
        className={common}
      />
    );
  }

  return (
    <div className="grid gap-1.5 border-b border-slate-50 py-3 last:border-0 sm:grid-cols-[1fr_280px] sm:items-center sm:gap-4">
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {s.description ? (
          <p className="text-xs text-slate-400">{s.description}</p>
        ) : null}
      </div>
      {control}
    </div>
  );
}

export default async function SettingsPage() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_setting")
    .select("*")
    .order("category")
    .order("key");

  const settings = (data ?? []) as Setting[];
  const byCategory = settings.reduce<Record<string, Setting[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  return (
    <form action={updateSettings} className="space-y-6">
      {Object.entries(byCategory).map(([cat, items]) => (
        <Panel key={cat} title={CATEGORY_LABELS[cat] ?? cat}>
          {items.map((s) => (
            <SettingField key={s.key} s={s} />
          ))}
        </Panel>
      ))}
      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
        >
          Save settings
        </button>
      </div>
    </form>
  );
}
