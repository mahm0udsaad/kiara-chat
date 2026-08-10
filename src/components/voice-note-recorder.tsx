"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldError } from "@/components/ui/field";

export interface VoiceNote {
  file: File;
  /** Object URL for playback — revoked when the note is replaced or cleared. */
  url: string;
  seconds: number;
}

function mmss(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Record a short note instead of typing one. Deliberately not hold-to-record
 * like the inbox: this is dictated once, reviewed, and only then sent with the
 * dispatch — so it needs playback and a way to start over.
 */
export function VoiceNoteRecorder({
  value,
  onChange,
  disabled,
  description,
}: {
  value: VoiceNote | null;
  onChange: (note: VoiceNote | null) => void;
  disabled?: boolean;
  description?: string;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTicking = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopTicking();
      recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stopTicking]);

  const start = useCallback(async () => {
    setError(null);
    // getUserMedia only exists in a secure context; over plain HTTP the API is
    // simply absent, so "allow the microphone" would be misleading advice.
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(
        typeof window !== "undefined" && !window.isSecureContext
          ? "تسجيل الصوت يتطلب اتصالاً آمنًا (HTTPS)."
          : "هذا المتصفح لا يدعم تسجيل الصوت."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48_000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      // ogg/opus is what WhatsApp itself uses for voice notes; Safari only
      // offers mp4, which still arrives as playable audio.
      const mime = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "";
      const rec = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 128_000,
      });
      chunksRef.current = [];
      let elapsed = 0;
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        stopTicking();
        const type = rec.mimeType || "audio/ogg";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        setRecording(false);
        if (!blob.size) return;
        const ext = type.includes("mp4") ? "m4a" : type.includes("webm") ? "webm" : "ogg";
        const file = new File([blob], `note-${Date.now()}.${ext}`, { type });
        onChange({ file, url: URL.createObjectURL(file), seconds: elapsed });
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setSeconds(0);
      tickRef.current = setInterval(() => {
        elapsed += 1;
        setSeconds(elapsed);
      }, 1000);
    } catch (e) {
      // Each of these needs a different action, so don't collapse them: a
      // denied permission in particular can only be reset in site settings.
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError(
          "الميكروفون محظور لهذا الموقع. فعّليه من إعدادات الموقع في المتصفح ثم أعيدي المحاولة."
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("لا يوجد ميكروفون متاح في هذا الجهاز.");
      } else if (name === "NotReadableError") {
        setError("الميكروفون مشغول بتطبيق آخر. أغلقيه ثم أعيدي المحاولة.");
      } else {
        setError("تعذّر بدء التسجيل. حاولي مرة أخرى.");
      }
    }
  }, [onChange, stopTicking]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const clear = useCallback(() => {
    if (value) URL.revokeObjectURL(value.url);
    onChange(null);
    setSeconds(0);
  }, [onChange, value]);

  if (value) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-xl border p-2">
          <audio src={value.url} controls className="h-9 min-w-0 flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={clear}
            disabled={disabled}
            aria-label="حذف التسجيل"
          >
            <Trash2 />
          </Button>
        </div>
        <FieldDescription>
          مدة التسجيل {mmss(value.seconds)} — سيصل الأخصائية كملاحظة صوتية بعد تفاصيل
          الحجز.
        </FieldDescription>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {recording ? (
        <Button type="button" variant="destructive" onClick={stop} className="min-h-11">
          <Square data-icon="inline-start" />
          إيقاف التسجيل · {mmss(seconds)}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={start}
          disabled={disabled}
          className="min-h-11"
        >
          <Mic data-icon="inline-start" />
          بدء التسجيل
        </Button>
      )}
      {error ? <FieldError>{error}</FieldError> : null}
      {description && !error ? <FieldDescription>{description}</FieldDescription> : null}
    </div>
  );
}
