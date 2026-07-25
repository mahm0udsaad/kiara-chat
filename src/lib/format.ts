const rtf = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });

/** Relative Arabic timestamp (e.g. "قبل ٣ دقائق"). */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), "day");
  return new Date(iso).toLocaleDateString("ar");
}
