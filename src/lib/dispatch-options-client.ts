import type {
  DispatchSettings,
  District,
  Driver,
  Specialist,
} from "@/lib/types";

export interface DispatchOptions {
  specialists: Specialist[];
  drivers: Driver[];
  settings: DispatchSettings | null;
  /** Active districts. `trip_price` is null for non-admins. */
  districts?: District[];
}

let cachedRequest: Promise<DispatchOptions> | null = null;

/**
 * One shared request for everything the driver-order sheet needs.
 *
 * Keeping the promise at module scope lets the inbox warm it in the background;
 * opening the sheet then reuses the same response instead of starting three
 * authenticated requests after the tap.
 */
export function loadDispatchOptions(): Promise<DispatchOptions> {
  if (cachedRequest) return cachedRequest;

  cachedRequest = fetch("/api/dispatch-options")
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "تعذّر تحميل بيانات الطلب");
      }
      return data as DispatchOptions;
    })
    .catch((error) => {
      // A temporary network failure should not poison every later open.
      cachedRequest = null;
      throw error;
    });

  return cachedRequest;
}

export function clearDispatchOptionsCache(): void {
  cachedRequest = null;
}
