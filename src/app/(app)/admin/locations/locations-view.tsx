"use client";

import { useState } from "react";
import {
  formatAddress,
  LOCATION_KIND_LABELS,
  type Location,
} from "@/lib/shared/locations";
import { Panel } from "../_components";
import { saveLocation, setLocationActive } from "../actions";

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100";

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  full,
  type,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  full?: boolean;
  type?: string;
}) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">
        {label}
      </span>
      <input
        name={name}
        type={type ?? "text"}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className={inputCls}
      />
    </label>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="min-w-0 break-words text-slate-700">{children}</span>
    </div>
  );
}

function LocationForm({
  location,
  locations,
  onClose,
}: {
  location: Location | null;
  locations: Location[];
  onClose: () => void;
}) {
  const parents = locations.filter(
    (l) => l.kind === "clinic" && l.id !== location?.id,
  );
  const nextOrder =
    location?.sort_order ??
    (locations.reduce((m, l) => Math.max(m, l.sort_order), 0) + 10);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            {location ? "Edit location" : "Add location"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <form action={saveLocation} className="space-y-4 p-5">
          {location ? <input type="hidden" name="id" value={location.id} /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Name *"
              name="name"
              defaultValue={location?.name}
              placeholder="Sherman Oaks"
            />
            <Field
              label="Display name"
              name="display_name"
              defaultValue={location?.display_name}
              placeholder="The Valley"
            />
            <Field
              label="Short code"
              name="short_code"
              defaultValue={location?.short_code}
              placeholder="SO"
            />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Type
              </span>
              <select
                name="kind"
                defaultValue={location?.kind ?? "clinic"}
                className={inputCls}
              >
                {(["clinic", "mobile"] as const).map((k) => (
                  <option key={k} value={k}>
                    {LOCATION_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Parked at (mobile)
              </span>
              <select
                name="parent_location_id"
                defaultValue={location?.parent_location_id ?? ""}
                className={inputCls}
              >
                <option value="">— None —</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  Color
                </span>
                <input
                  name="color"
                  type="color"
                  defaultValue={location?.color ?? "#64748b"}
                  className="block h-9 w-full cursor-pointer rounded-lg border border-slate-200"
                />
              </label>
              <Field
                label="Order"
                name="sort_order"
                type="number"
                defaultValue={String(nextOrder)}
              />
            </div>
          </div>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Address
            </legend>
            <Field
              label="Street"
              name="address_line1"
              defaultValue={location?.address_line1}
              placeholder="13907 Ventura Blvd"
              full
            />
            <Field
              label="Unit / Suite"
              name="address_line2"
              defaultValue={location?.address_line2}
              placeholder="Unit 101"
            />
            <Field
              label="City"
              name="city"
              defaultValue={location?.city}
              placeholder="Sherman Oaks"
            />
            <Field
              label="State"
              name="state"
              defaultValue={location?.state}
              placeholder="CA"
            />
            <Field
              label="ZIP"
              name="postal_code"
              defaultValue={location?.postal_code}
              placeholder="91423"
            />
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Contact
            </legend>
            <Field
              label="Phone"
              name="phone"
              defaultValue={location?.phone}
              placeholder="(310) 606-2407"
            />
            <Field
              label="Email"
              name="email"
              defaultValue={location?.email}
              placeholder="info@greendogdental.com"
            />
            <Field
              label="Map URL"
              name="map_url"
              defaultValue={location?.map_url}
              full
            />
            <Field
              label="Website URL"
              name="website_url"
              defaultValue={location?.website_url}
              full
            />
            <Field
              label="Notes"
              name="notes"
              defaultValue={location?.notes}
              full
            />
          </fieldset>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={location?.is_active ?? true}
            />
            Active
          </label>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              {location ? "Save location" : "Add location"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LocationCard({
  location,
  byId,
  onEdit,
}: {
  location: Location;
  byId: Map<string, Location>;
  onEdit: () => void;
}) {
  const address = formatAddress(location);
  const parent = location.parent_location_id
    ? byId.get(location.parent_location_id)
    : null;

  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        location.is_active ? "border-slate-200" : "border-slate-200 opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="mt-0.5 h-4 w-4 shrink-0 rounded"
            style={{ background: location.color ?? "#64748b" }}
            aria-hidden
          />
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {location.name}
              {location.short_code ? (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                  {location.short_code}
                </span>
              ) : null}
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                {LOCATION_KIND_LABELS[location.kind]}
              </span>
              {!location.is_active ? (
                <span className="text-[11px] font-medium text-slate-400">
                  inactive
                </span>
              ) : null}
            </p>
            {location.display_name && location.display_name !== location.name ? (
              <p className="text-xs text-slate-400">{location.display_name}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            Edit
          </button>
          <form action={setLocationActive}>
            <input type="hidden" name="id" value={location.id} />
            <input
              type="hidden"
              name="is_active"
              value={location.is_active ? "false" : "true"}
            />
            <button
              type="submit"
              className="text-xs font-medium text-slate-400 hover:text-slate-700"
            >
              {location.is_active ? "Deactivate" : "Activate"}
            </button>
          </form>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {address ? (
          <InfoRow label="Address">
            {location.map_url ? (
              <a
                href={location.map_url}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-700 hover:underline"
              >
                {address}
              </a>
            ) : (
              address
            )}
          </InfoRow>
        ) : null}
        {location.phone ? (
          <InfoRow label="Phone">
            <a href={`tel:${location.phone}`} className="hover:underline">
              {location.phone}
            </a>
          </InfoRow>
        ) : null}
        {location.email ? (
          <InfoRow label="Email">
            <a href={`mailto:${location.email}`} className="hover:underline">
              {location.email}
            </a>
          </InfoRow>
        ) : null}
        {parent ? <InfoRow label="Parked at">{parent.name}</InfoRow> : null}
        {location.notes ? <InfoRow label="Notes">{location.notes}</InfoRow> : null}
      </div>
    </div>
  );
}

export function LocationsView({ locations }: { locations: Location[] }) {
  const [editing, setEditing] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);
  const byId = new Map(locations.map((l) => [l.id, l]));
  const activeCount = locations.filter((l) => l.is_active).length;

  return (
    <Panel
      title="Locations"
      description={`${activeCount} active · ${locations.length} total — the single source of truth used across scheduling, HR, and CRM.`}
      actions={
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          + Add location
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {locations.map((l) => (
          <LocationCard
            key={l.id}
            location={l}
            byId={byId}
            onEdit={() => setEditing(l)}
          />
        ))}
      </div>

      {(editing || creating) && (
        <LocationForm
          location={editing}
          locations={locations}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </Panel>
  );
}
