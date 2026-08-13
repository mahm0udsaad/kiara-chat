"use client";

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  UserPlus,
  Check,
  Pencil,
  Ban,
  RotateCcw,
  X,
  KeyRound,
  Wand2,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NATIONALITIES, nationalityOf } from "@/lib/nationalities";
import type { Specialist, Driver } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import type { FieldStaffAccountSummary } from "@/lib/field-staff";

type Row = Specialist | Driver;
type Kind = "specialist" | "driver";

/** The picker used both for adding and editing a specialist. */
function NationalitySelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="جنسية الأخصائية"
      className={cn(
        "min-h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--brand)]",
        className
      )}
    >
      <option value="">الجنسية…</option>
      {NATIONALITIES.map((n) => (
        <option key={n.code} value={n.code}>
          {n.label} — {n.languageLabel}
        </option>
      ))}
    </select>
  );
}

const ENDPOINT: Record<Kind, string> = {
  specialist: "/api/specialists",
  driver: "/api/drivers",
};

/**
 * Admin-only roster administration on the /team page: add, rename/renumber, and
 * activate/deactivate specialists and drivers. Deactivating hides someone from
 * the order pickers without deleting their past orders. Employees never reach
 * this page (the route is requireAdmin) and the API routes reject non-admins.
 */
export function RosterManager({
  initialSpecialists,
  initialDrivers,
  initialAccounts,
}: {
  initialSpecialists: Specialist[];
  initialDrivers: Driver[];
  initialAccounts: FieldStaffAccountSummary[];
}) {
  const [specialists, setSpecialists] = useState(initialSpecialists);
  const [drivers, setDrivers] = useState(initialDrivers);
  const [accounts, setAccounts] = useState(initialAccounts);

  return (
    <div className="dashboard-page max-w-3xl pt-0!">
      <div className="dashboard-page-header">
        <div>
          <h1>الأخصائيات والسائقون</h1>
          <p>تُدار من هنا وتظهر في قائمة إنشاء الطلب. إيقاف أي شخص يُخفيه دون حذف طلباته.</p>
        </div>
      </div>

      <div className="space-y-6">
        <RosterSection
          title="الأخصائيات"
          kind="specialist"
          phoneRequired={false}
          withNationality
          items={specialists}
          onItems={setSpecialists}
          accounts={accounts}
          onAccount={(account) =>
            setAccounts((current) => [
              ...current.filter((item) => item.rosterId !== account.rosterId),
              account,
            ])
          }
        />
        <RosterSection
          title="السائقون"
          kind="driver"
          phoneRequired
          items={drivers}
          onItems={setDrivers}
          accounts={accounts}
          onAccount={(account) =>
            setAccounts((current) => [
              ...current.filter((item) => item.rosterId !== account.rosterId),
              account,
            ])
          }
        />
      </div>
    </div>
  );
}

function RosterSection<T extends Row>({
  title,
  kind,
  phoneRequired,
  withNationality = false,
  items,
  onItems,
  accounts,
  onAccount,
}: {
  title: string;
  kind: Kind;
  phoneRequired: boolean;
  /** Specialists only: show the nationality picker (drives translation). */
  withNationality?: boolean;
  items: T[];
  onItems: (updater: (prev: T[]) => T[]) => void;
  accounts: FieldStaffAccountSummary[];
  onAccount: (account: FieldStaffAccountSummary) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [nationality, setNationality] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rowFromResponse = (data: Record<string, unknown>): T =>
    (kind === "driver" ? data.driver : data.specialist) as T;

  const add = useCallback(async () => {
    setError(null);
    if (!name.trim()) return setError("الاسم مطلوب");
    if (phoneRequired && !phone.trim()) return setError("رقم السائق مطلوب");
    setAdding(true);
    try {
      const res = await fetch(ENDPOINT[kind], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: name.trim(),
          phone: phone.trim() || undefined,
          nationality: (withNationality && nationality) || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data?.error ?? "تعذّرت الإضافة");
      onItems((p) => [...p, rowFromResponse(data)]);
      setName("");
      setPhone("");
      setNationality("");
    } catch {
      setError("تعذّرت الإضافة");
    } finally {
      setAdding(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, phone, nationality, withNationality, kind, phoneRequired, onItems]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setError(null);
      setBusyId(id);
      try {
        const res = await fetch(`${ENDPOINT[kind]}/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error ?? "تعذّر التحديث");
          return false;
        }
        onItems((p) => p.map((it) => (it.id === id ? rowFromResponse(data) : it)));
        return true;
      } catch {
        setError("تعذّر التحديث");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, onItems]
  );

  return (
    <section className="rounded-2xl border bg-[var(--surface)] p-4 sm:p-5">
      <h2 className="mb-3 font-semibold text-[var(--foreground)]">{title}</h2>

      {/* Add row */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="الاسم"
          className="min-h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-[var(--brand)]"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          dir="ltr"
          placeholder={phoneRequired ? "رقم واتساب (‎+9665…)" : "رقم (اختياري)"}
          className="min-h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-[var(--brand)]"
        />
        {withNationality ? (
          <NationalitySelect value={nationality} onChange={setNationality} />
        ) : null}
        <button
          type="button"
          onClick={add}
          disabled={adding}
          className="flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {adding ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
          إضافة
        </button>
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertTriangle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {items.length ? (
        <ul className="divide-y">
          {items.map((it) => (
            <RosterRow
              key={it.id}
              row={it}
              busy={busyId === it.id}
              withNationality={withNationality}
              kind={kind}
              account={accounts.find((account) => account.rosterId === it.id) ?? null}
              onAccount={onAccount}
              onSave={(fullName, phoneVal, nat) =>
                patch(it.id, {
                  fullName,
                  phone: phoneVal,
                  ...(withNationality ? { nationality: nat || null } : {}),
                })
              }
              onToggleActive={() => patch(it.id, { isActive: !it.is_active })}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">لا يوجد أحد بعد.</p>
      )}
    </section>
  );
}

function RosterRow({
  row,
  busy,
  withNationality,
  onSave,
  onToggleActive,
  kind,
  account,
  onAccount,
}: {
  row: Row;
  busy: boolean;
  withNationality: boolean;
  onSave: (fullName: string, phone: string, nationality: string) => Promise<boolean>;
  onToggleActive: () => void;
  kind: Kind;
  account: FieldStaffAccountSummary | null;
  onAccount: (account: FieldStaffAccountSummary) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.full_name);
  const [phone, setPhone] = useState(row.phone ?? "");
  const rowNationality = (row as Specialist).nationality ?? "";
  const [nationality, setNationality] = useState(rowNationality);
  const natInfo = nationalityOf(rowNationality);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountPassword, setAccountPassword] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [savedPassword, setSavedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generatePassword = () => {
    const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
    const bytes = new Uint32Array(8);
    crypto.getRandomValues(bytes);
    return `kiara-${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join("")}`;
  };

  const openAccount = () => {
    setAccountPassword(generatePassword());
    setAccountError(null);
    setSavedPassword(null);
    setCopied(false);
    setAccountOpen(true);
  };

  const saveAccount = async () => {
    setAccountBusy(true);
    setAccountError(null);
    try {
      const response = await fetch(`/api/field-staff/${kind}/${row.id}/account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: accountPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAccountError(data?.error ?? "تعذّر إنشاء الدخول");
        return;
      }
      onAccount(data.account as FieldStaffAccountSummary);
      setSavedPassword(accountPassword);
    } catch {
      setAccountError("تعذّر إنشاء الدخول");
    } finally {
      setAccountBusy(false);
    }
  };

  const save = async () => {
    const ok = await onSave(name, phone, nationality);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-10 w-full rounded-lg border px-2 text-sm outline-none focus:border-[var(--brand)]"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          dir="ltr"
          placeholder="الرقم"
          className="min-h-10 w-full rounded-lg border px-2 text-sm outline-none focus:border-[var(--brand)]"
        />
        {withNationality ? (
          <NationalitySelect
            value={nationality}
            onChange={setNationality}
            className="min-h-10 px-2"
          />
        ) : null}
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            aria-label="حفظ"
            className="flex size-10 items-center justify-center rounded-lg bg-[var(--brand)] text-white disabled:opacity-60"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setName(row.full_name);
              setPhone(row.phone ?? "");
              setNationality(rowNationality);
            }}
            aria-label="إلغاء"
            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5"
          >
            <X size={16} />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn("flex items-center gap-3 py-2.5", !row.is_active && "opacity-55")}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--foreground)]">
          {row.full_name}
          {natInfo ? (
            <span
              className="mr-2 rounded-full bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] text-[var(--brand)]"
              title={`تُرسل رسائلها مترجمة إلى ${natInfo.languageLabel}`}
            >
              {natInfo.label}
            </span>
          ) : null}
          {account ? (
            <span className="mr-2 rounded-full bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] text-[var(--brand)]">
              دخول التطبيق مفعّل
            </span>
          ) : null}
          {!row.is_active ? (
            <span className="mr-2 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
              موقوف
            </span>
          ) : null}
        </p>
        {row.phone ? (
          <p dir="ltr" className="truncate text-right text-xs text-muted-foreground">
            {row.phone}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={openAccount}
          aria-label={account ? "تغيير كلمة مرور التطبيق" : "إنشاء دخول التطبيق"}
          title={account ? "تغيير كلمة مرور التطبيق" : "إنشاء دخول التطبيق"}
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5"
        >
          <KeyRound size={15} />
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="تعديل"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5"
        >
          <Pencil size={15} />
        </button>
        <button
          type="button"
          onClick={onToggleActive}
          disabled={busy}
          aria-label={row.is_active ? "إيقاف" : "تفعيل"}
          className={cn(
            "flex size-9 items-center justify-center rounded-lg hover:bg-black/5 disabled:opacity-50",
            row.is_active ? "text-amber-600" : "text-emerald-600"
          )}
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : row.is_active ? (
            <Ban size={15} />
          ) : (
            <RotateCcw size={15} />
          )}
        </button>
      </div>
      <Modal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        title={`${account ? "تغيير دخول" : "إنشاء دخول"} ${row.full_name}`}
      >
        {savedPassword ? (
          <div className="flex flex-col gap-3">
            <Alert>
              <Check />
              <AlertDescription>
                تم الحفظ. انسخي الرقم وكلمة المرور الآن؛ كلمة المرور لن تظهر مرة أخرى.
              </AlertDescription>
            </Alert>
            <div className="rounded-lg border p-3 text-sm">
              <p className="text-muted-foreground">رقم الدخول</p>
              <code dir="ltr" className="block select-all text-base font-semibold">
                {row.phone}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="flex-1 select-all rounded-lg border bg-[var(--brand-soft)] px-3 py-2.5 font-semibold"
              >
                {savedPassword}
              </code>
              <button
                type="button"
                aria-label="نسخ كلمة المرور"
                onClick={async () => {
                  await navigator.clipboard.writeText(savedPassword);
                  setCopied(true);
                }}
                className="flex size-11 items-center justify-center rounded-lg border"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setAccountOpen(false)}
              className="min-h-11 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white"
            >
              تم
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Alert>
              <KeyRound />
              <AlertDescription>
                سيدخل {kind === "specialist" ? "الأخصائية" : "السائق"} مباشرة برقم
                الهاتف وكلمة المرور، من دون بريد أو رمز تحقق.
              </AlertDescription>
            </Alert>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">رقم الدخول</span>
              <input
                value={row.phone ?? ""}
                readOnly
                dir="ltr"
                className="min-h-11 rounded-lg border bg-muted px-3"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">كلمة المرور — يمكنك تعديلها قبل الحفظ</span>
              <div className="flex items-center gap-2">
                <input
                  value={accountPassword}
                  onChange={(event) => setAccountPassword(event.target.value)}
                  dir="ltr"
                  minLength={8}
                  className="min-h-11 flex-1 rounded-lg border px-3"
                />
                <button
                  type="button"
                  onClick={() => setAccountPassword(generatePassword())}
                  aria-label="توليد كلمة مرور جديدة"
                  className="flex size-11 items-center justify-center rounded-lg border"
                >
                  <Wand2 size={16} />
                </button>
              </div>
            </label>
            {accountError ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>{accountError}</AlertDescription>
              </Alert>
            ) : null}
            <button
              type="button"
              onClick={saveAccount}
              disabled={accountBusy || accountPassword.length < 8 || !row.phone}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {accountBusy ? <Loader2 className="animate-spin" /> : <KeyRound />}
              {account ? "حفظ كلمة المرور الجديدة" : "إنشاء دخول التطبيق"}
            </button>
          </div>
        )}
      </Modal>
    </li>
  );
}
