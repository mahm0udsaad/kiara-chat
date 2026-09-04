import { NextResponse } from "next/server";

/**
 * POST /api/webhooks/openwa — retired.
 *
 * This was the ingest endpoint for the linked-device engine: it persisted live
 * inbound and fromMe messages, which is how ~99% of the salon's outbound
 * traffic (typed in the WhatsApp phone app) ever reached Kiara. The engine was
 * stopped on 2026-09-04 and its pm2 entry removed.
 *
 * It answers 410 rather than being deleted outright, deliberately. The engine
 * code and its session directory still sit on the VPS, so someone could start
 * it again by hand — and an engine that came back would happily replay its
 * whole backlog into a database that has since moved to the Business number,
 * writing messages against a transport that can no longer send. A refusal that
 * names itself is the difference between "this is retired" and a silent 404
 * that reads like a deploy went wrong.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "OPENWA_RETIRED",
      detail:
        "The linked-device engine was retired on 2026-09-04. Kiara ingests WhatsApp only through /api/webhooks/twilio.",
    },
    { status: 410 },
  );
}
