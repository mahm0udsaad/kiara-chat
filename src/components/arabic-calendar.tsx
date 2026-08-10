"use client";

import type { ComponentProps } from "react";
import { arSA } from "date-fns/locale";
import type { PropsBase, PropsSingle } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";

type ArabicCalendarProps = Omit<PropsBase, "locale"> &
  PropsSingle & {
    buttonVariant?: ComponentProps<typeof Calendar>["buttonVariant"];
  };

/** Keep the large DayPicker + Arabic locale bundle behind a dynamic import. */
export function ArabicCalendar(props: ArabicCalendarProps) {
  return <Calendar locale={arSA} {...props} />;
}
