export interface ServiceChangeList {
  services: {
    id: string;
    name: string;
    minutes: number;
    sourceId: string | null;
  }[];
  candidates: {
    sourceId: string;
    sourceHash: string;
    name: string;
    minutes: number;
    serviceId: string | null;
    kind: string;
    reasons: string[];
  }[];
  notifications: {
    id: string;
    role: string;
    status: string;
    last_error: string | null;
    body: string;
  }[];
  syncedAt: string | null;
  canAdd: boolean;
}
export interface ServiceChangePreview {
  id: string;
  name: string;
  minutes: number;
  oldEnd: string;
  newEnd: string;
  extensionMinutes: number;
  specialistTitle: string;
  driverTitle: string;
  specialistMessage: string;
  driverMessage: string;
}
