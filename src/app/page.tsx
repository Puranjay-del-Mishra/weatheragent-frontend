"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Units = "metric" | "imperial";

type Draft = {
  email: string;
  timezone: string;
  preferred_time: string; // "HH:MM"
  units: Units;
  cities: string[];
  is_active: boolean;
};

const DRAFT_KEY = "weatherAgentDraft:v1";
const MIN_AHEAD_MINUTES = 2;

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

function clampCities(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const v = (raw ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.slice(0, 10);
}

function isEmailLike(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/**
 * Returns local HH:MM for a given timezone.
 */
function nowHHMMInTimeZone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

function parseHHMM(s: string) {
  const m = /^(\d{2}):(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function minutesOfDay(hh: number, mm: number) {
  return hh * 60 + mm;
}

function hhmmToMinutes(s: string) {
  const p = parseHHMM(s);
  if (!p) return null;
  return minutesOfDay(p.hh, p.mm);
}

/**
 * Adds minutes to "now" in a timezone and returns HH:MM.
 * Wraps across midnight (e.g. 23:59 + 2 => 00:01).
 */
function addMinutesHHMMInTimeZone(timezone: string, minutesToAdd: number) {
  const base = nowHHMMInTimeZone(timezone);
  const p = parseHHMM(base);
  if (!p) return base;

  let total = minutesOfDay(p.hh, p.mm) + minutesToAdd;
  total = ((total % 1440) + 1440) % 1440;

  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Minutes from "now in timezone" until preferredHHMM.
 * If preferred time is earlier than now, treat it as "tomorrow".
 * Example: now 23:59, preferred 00:01 => 2 minutes.
 */
function minutesUntilSend(timezone: string, preferredHHMM: string) {
  const nowStr = nowHHMMInTimeZone(timezone);
  const nowP = parseHHMM(nowStr);
  const prefP = parseHHMM(preferredHHMM);
  if (!nowP || !prefP) return null;

  const nowMin = minutesOfDay(nowP.hh, nowP.mm);
  const prefMin = minutesOfDay(prefP.hh, prefP.mm);

  if (prefMin >= nowMin) return prefMin - nowMin; // later today
  return (1440 - nowMin) + prefMin; // wrap to tomorrow
}

function isAtLeastMinutesAhead(timezone: string, preferredHHMM: string, minAhead: number) {
  const diff = minutesUntilSend(timezone, preferredHHMM);
  return diff !== null && diff >= minAhead;
}

export default function Page() {
  const detectedTz =
    (typeof Intl !== "undefined" &&
      Intl.DateTimeFormat().resolvedOptions().timeZone) ||
    "UTC";

  const [draft, setDraft] = useState<Draft>({
    email: "",
    timezone: detectedTz,
    preferred_time: nowHHMMInTimeZone(detectedTz),
    units: "metric",
    cities: ["London"],
    is_active: true,
  });

  const [cityInput, setCityInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // Inline edit state for city chips
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  const toastTimer = useRef<number | null>(null);

  function showToast(kind: "ok" | "err", msg: string) {
    setToast({ kind, msg });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }

  // Restore draft from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Draft>;
      setDraft((prev) => {
        const tz = (parsed.timezone || prev.timezone || "UTC").trim();
        return {
          ...prev,
          ...parsed,
          timezone: tz,
          preferred_time: (parsed.preferred_time || prev.preferred_time || "09:00").slice(0, 5),
          units: parsed.units === "imperial" ? "imperial" : "metric",
          cities: clampCities(parsed.cities ?? prev.cities ?? []),
          is_active: typeof parsed.is_active === "boolean" ? parsed.is_active : prev.is_active,
        };
      });
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist draft
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }, [draft]);

  const timeValid = useMemo(() => {
    return /^\d{2}:\d{2}$/.test(draft.preferred_time);
  }, [draft.preferred_time]);

  const scheduledAheadOk = useMemo(() => {
    if (!timeValid) return false;
    return isAtLeastMinutesAhead(draft.timezone, draft.preferred_time, MIN_AHEAD_MINUTES);
  }, [draft.timezone, draft.preferred_time, timeValid]);

  const canSave = useMemo(() => {
    return (
      isEmailLike(draft.email) &&
      draft.timezone.trim().length > 0 &&
      timeValid &&
      draft.cities.length >= 1 &&
      scheduledAheadOk
    );
  }, [draft, timeValid, scheduledAheadOk]);

  const preview = useMemo(() => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const subject = `WeatherAgent – ${dateStr} (${draft.timezone || "UTC"})`;

    const cityLines = draft.cities.map(
      (c) =>
        `- Daily Weather - ${c}\n  Temp: …\n  Humidity: …\n  Wind: …\n  Condition: …\n  Alert: …\n`,
    );

    const bodyText =
      `Overall Alerts: …\n\n` +
      `WeatherAgent (${draft.timezone || "UTC"})\n\n` +
      cityLines.join("\n");

    return { subject, bodyText };
  }, [draft.cities, draft.timezone]);

  function addCity() {
    const v = cityInput.trim();
    if (!v) return;
    setDraft((d) => ({ ...d, cities: clampCities([...d.cities, v]) }));
    setCityInput("");
  }

  function removeCity(idx: number) {
    setDraft((d) => ({ ...d, cities: d.cities.filter((_, i) => i !== idx) }));
    if (editingIndex === idx) {
      setEditingIndex(null);
      setEditingValue("");
    }
  }

  function startEditCity(idx: number) {
    setEditingIndex(idx);
    setEditingValue(draft.cities[idx] ?? "");
  }

  function cancelEditCity() {
    setEditingIndex(null);
    setEditingValue("");
  }

  function commitEditCity() {
    if (editingIndex === null) return;
    const v = editingValue.trim();
    if (!v) return;
    setDraft((d) => {
      const next = [...d.cities];
      next[editingIndex] = v;
      return { ...d, cities: clampCities(next) };
    });
    setEditingIndex(null);
    setEditingValue("");
  }

  async function saveSubscription(opts?: { testNow?: boolean }) {
    setSaving(true);
    setToast(null);

    // For "Send test": schedule it MIN_AHEAD_MINUTES into the future (in selected timezone)
    const scheduled = opts?.testNow
      ? addMinutesHHMMInTimeZone(draft.timezone, MIN_AHEAD_MINUTES)
      : draft.preferred_time;

    // Enforce the rule for normal save
    if (!opts?.testNow && !scheduledAheadOk) {
      showToast(
        "err",
        `Pick a time at least ${MIN_AHEAD_MINUTES} minutes from now (in ${draft.timezone}). (Tomorrow is allowed.)`,
      );
      setSaving(false);
      return;
    }

    const payload = {
      email: draft.email.trim(),
      timezone: draft.timezone.trim(),
      preferred_time: scheduled.trim(),
      units: draft.units,
      cities: draft.cities,
      is_active: draft.is_active,
    };

    try {
      const res = await fetch("/api/placeholder-upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text().catch(() => "");

      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      if (opts?.testNow) {
        showToast("ok", `Saved — test scheduled for ${scheduled} (${draft.timezone})`);
        setDraft((d) => ({ ...d, preferred_time: scheduled }));
      } else {
        showToast("ok", "Saved");
      }
    } catch (e: any) {
      showToast("err", e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const minAheadHint = useMemo(() => {
    const nowLocal = nowHHMMInTimeZone(draft.timezone);
    const minOk = addMinutesHHMMInTimeZone(draft.timezone, MIN_AHEAD_MINUTES);
    const diff = minutesUntilSend(draft.timezone, draft.preferred_time);

    const nowMin = hhmmToMinutes(nowLocal);
    const prefMin = hhmmToMinutes(draft.preferred_time);
    const when =
      nowMin === null || prefMin === null
        ? null
        : prefMin >= nowMin
          ? "today"
          : "tomorrow";

    return { nowLocal, minOk, diff, when };
  }, [draft.timezone, draft.preferred_time]);

  return (
    <main className="min-h-screen w-full bg-gradient-to-b from-zinc-50 to-zinc-100 text-zinc-900">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">WeatherAgent</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Create or update a subscriber. n8n scans every minute and sends when due.
            </p>
          </div>

          {toast && (
            <div
              className={[
                "rounded-2xl px-4 py-2 text-sm shadow-sm ring-1",
                toast.kind === "ok"
                  ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
                  : "bg-rose-50 text-rose-900 ring-rose-200",
              ].join(" ")}
            >
              {toast.msg}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left: Form Card */}
          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
            <div className="space-y-5">
              {/* Email */}
              <div>
                <label className="text-sm font-medium">Email</label>
                <input
                  className="mt-2 w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300"
                  placeholder="name@company.com"
                  value={draft.email}
                  onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                />
                <p className="mt-2 text-xs text-zinc-500">
                  If this email exists, saving will update the subscription.
                </p>
              </div>

              {/* TZ + Time */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">Timezone</label>
                  <select
                    className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300"
                    value={draft.timezone}
                    onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}
                  >
                    {clampCities([draft.timezone, ...COMMON_TIMEZONES]).map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium">Preferred time</label>
                  <input
                    type="time"
                    className={[
                      "mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2",
                      scheduledAheadOk ? "border-zinc-200 focus:ring-zinc-300" : "border-rose-200 focus:ring-rose-200",
                    ].join(" ")}
                    value={draft.preferred_time}
                    onChange={(e) => setDraft((d) => ({ ...d, preferred_time: e.target.value }))}
                  />
                  <p className="mt-2 text-xs text-zinc-500">
                    Now in {draft.timezone}: <b>{minAheadHint.nowLocal}</b>. Minimum safe time:{" "}
                    <b>{minAheadHint.minOk}</b> (≥ {MIN_AHEAD_MINUTES} min ahead).
                    {minAheadHint.diff !== null && (
                      <>
                        {" "}Your selection triggers in <b>{minAheadHint.diff}</b> min{" "}
                        {minAheadHint.when ? `(${minAheadHint.when})` : ""}.
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Units */}
              <div>
                <label className="text-sm font-medium">Units</label>
                <div className="mt-2 inline-flex rounded-2xl bg-zinc-100 p-1">
                  <button
                    type="button"
                    className={[
                      "rounded-2xl px-4 py-2 text-sm transition",
                      draft.units === "metric" ? "bg-white shadow-sm" : "text-zinc-600 hover:text-zinc-900",
                    ].join(" ")}
                    onClick={() => setDraft((d) => ({ ...d, units: "metric" }))}
                  >
                    Metric
                  </button>
                  <button
                    type="button"
                    className={[
                      "rounded-2xl px-4 py-2 text-sm transition",
                      draft.units === "imperial" ? "bg-white shadow-sm" : "text-zinc-600 hover:text-zinc-900",
                    ].join(" ")}
                    onClick={() => setDraft((d) => ({ ...d, units: "imperial" }))}
                  >
                    Imperial
                  </button>
                </div>
              </div>

              {/* Cities */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Cities</label>
                  <span className="text-xs text-zinc-500">Start with 1 city, add more anytime</span>
                </div>

                <div className="mt-2 flex gap-2">
                  <input
                    className="w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300"
                    placeholder="Add a city (e.g., London)"
                    value={cityInput}
                    onChange={(e) => setCityInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCity();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-40"
                    onClick={addCity}
                    disabled={!cityInput.trim()}
                  >
                    Add
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {draft.cities.map((c, idx) => {
                    const isEditing = editingIndex === idx;
                    return (
                      <div
                        key={`${c}-${idx}`}
                        className="group inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-2 text-sm"
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="w-40 rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm outline-none focus:ring-2 focus:ring-zinc-300"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEditCity();
                              if (e.key === "Escape") cancelEditCity();
                            }}
                            onBlur={commitEditCity}
                          />
                        ) : (
                          <button type="button" className="text-left" title="Click to edit" onClick={() => startEditCity(idx)}>
                            {c}
                          </button>
                        )}

                        <button
                          type="button"
                          className="rounded-full px-2 py-1 text-zinc-500 hover:bg-white hover:text-zinc-900"
                          title="Remove"
                          onClick={() => removeCity(idx)}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>

                <p className="mt-2 text-xs text-zinc-500">
                  Tip: click a city chip to edit. Press Enter to save, Esc to cancel.
                </p>
              </div>

              {/* Active */}
              <div className="flex items-center justify-between rounded-2xl border border-zinc-200 px-4 py-3">
                <div>
                  <div className="text-sm font-medium">Active</div>
                  <div className="text-xs text-zinc-500">Inactive subscribers won’t receive emails.</div>
                </div>
                <button
                  type="button"
                  className={[
                    "h-9 w-16 rounded-full p-1 transition",
                    draft.is_active ? "bg-emerald-200" : "bg-zinc-200",
                  ].join(" ")}
                  onClick={() => setDraft((d) => ({ ...d, is_active: !d.is_active }))}
                >
                  <div
                    className={[
                      "h-7 w-7 rounded-full bg-white shadow-sm transition",
                      draft.is_active ? "translate-x-7" : "translate-x-0",
                    ].join(" ")}
                  />
                </button>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  className="w-full rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40"
                  disabled={!canSave || saving}
                  onClick={() => saveSubscription()}
                >
                  {saving ? "Saving…" : "Save subscription"}
                </button>

                <button
                  type="button"
                  className="w-full rounded-2xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 transition hover:bg-zinc-200/60 disabled:opacity-40"
                  disabled={!isEmailLike(draft.email) || saving}
                  onClick={() => saveSubscription({ testNow: true })}
                >
                  Send test (in {MIN_AHEAD_MINUTES} min)
                </button>
              </div>

              {!scheduledAheadOk && (
                <p className="text-xs text-rose-700">
                  Scheduled time must be at least {MIN_AHEAD_MINUTES} minutes from now (in {draft.timezone}). Midnight wrap is allowed.
                </p>
              )}

              <p className="text-xs text-zinc-500">
                “Send test” schedules your preferred time to <b>{MIN_AHEAD_MINUTES} minutes</b> from now (in your selected timezone),
                so the next n8n scan reliably picks it up.
              </p>
            </div>
          </section>

          {/* Right: Preview */}
          <aside className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-700">Preview</h2>
              <span className="text-xs text-zinc-500">Live</span>
            </div>

            <div className="mt-4 rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
              <div className="text-xs text-zinc-500">Subject</div>
              <div className="mt-1 text-sm font-medium">{preview.subject}</div>
            </div>

            <div className="mt-4 rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
              <div className="text-xs text-zinc-500">Body (text)</div>
              <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-900">
                {preview.bodyText}
              </pre>
            </div>

            <p className="mt-3 text-xs text-zinc-500">
              This preview mirrors your Edge Function format (overall alerts + per-city sections).
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
