"use client";

/**
 * Placing a WhatsApp call from the browser.
 *
 * The peer connection lives here, in the tab — media goes straight from this
 * machine to Meta's servers and never touches our own. The server's only job
 * is to carry two SDP blobs in opposite directions.
 *
 * The sequence, and why it is this way:
 *
 *   1. Fetch ICE servers first. Candidates are gathered against them, so they
 *      have to exist before the peer connection does.
 *   2. Build the offer, then *wait for gathering to finish*. The Calling API
 *      takes one complete SDP; there is nowhere to trickle a late candidate to.
 *      A deadline caps that wait, because gathering against an unreachable
 *      TURN server otherwise hangs until the browser gives up.
 *   3. POST the offer. The response carries Meta's call id, not the answer.
 *   4. The answer arrives on the realtime channel, or from polling the row if
 *      the broadcast landed before this client had subscribed. Whichever wins.
 */
import { createClient } from "@/lib/supabase/client";

/** How long to wait for ICE gathering before sending what we have. */
const GATHER_DEADLINE_MS = 2500;
/** How long to wait for Meta's SDP answer before giving up on the call. */
const ANSWER_DEADLINE_MS = 20_000;
const POLL_INTERVAL_MS = 1200;

export type CallPhase =
  | "idle"
  | "preparing"
  | "dialling"
  | "ringing"
  | "connected"
  | "ended"
  | "failed";

export interface CallState {
  phase: CallPhase;
  waCallId: string | null;
  error: string | null;
  /** True when no TURN relay is configured — calls may fail on strict NATs. */
  relayMissing: boolean;
  startedAt: number | null;
}

type Listener = (state: CallState) => void;

interface IceResponse {
  iceServers: RTCIceServer[];
  relayAvailable: boolean;
}

/**
 * Resolve once the peer connection has gathered everything it is going to, or
 * once the deadline passes — whichever comes first.
 */
function gatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    // Sending a partial candidate set is better than sending nothing: the
    // host and server-reflexive candidates are usually already in by now, and
    // they are the ones that carry most calls.
    const timer = setTimeout(finish, GATHER_DEADLINE_MS);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

/**
 * One outbound call, from microphone permission to hangup.
 *
 * Deliberately a class rather than a hook: a call outlives any single render,
 * and the teardown has to run exactly once even if the component unmounts
 * mid-dial — otherwise the customer's phone keeps ringing with nobody on this
 * end.
 */
export class OutboundCall {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private answerApplied = false;
  private disposed = false;
  private listeners = new Set<Listener>();

  private state: CallState = {
    phase: "idle",
    waCallId: null,
    error: null,
    relayMissing: false,
    startedAt: null,
  };

  /** The customer's audio. Attach to an <audio autoplay> element. */
  readonly remoteStream = new MediaStream();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private patch(next: Partial<CallState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }

  private fail(message: string) {
    if (this.state.phase === "ended" || this.state.phase === "failed") return;
    this.patch({ phase: "failed", error: message });
    void this.hangUp();
  }

  async start(conversationId: string): Promise<void> {
    if (this.state.phase !== "idle") return;
    this.patch({ phase: "preparing", error: null });

    try {
      const ice = await this.fetchIce();
      this.patch({ relayMissing: !ice.relayAvailable });

      // Asked for after the ICE fetch so a configuration failure does not
      // light the browser's microphone indicator for nothing.
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (this.disposed) return;

      const pc = new RTCPeerConnection({ iceServers: ice.iceServers });
      this.pc = pc;

      // addTrack creates the sendrecv audio transceiver on its own. Adding an
      // explicit one as well puts a second audio m-line in the offer, which is
      // not what a WhatsApp call negotiates against.
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }

      pc.ontrack = (event) => {
        for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
          this.remoteStream.addTrack(track);
        }
      };
      pc.onconnectionstatechange = () => {
        if (this.disposed) return;
        if (pc.connectionState === "connected") {
          this.patch({ phase: "connected", startedAt: Date.now() });
        } else if (pc.connectionState === "failed") {
          // Almost always NAT traversal with no relay to fall back on.
          this.fail(
            this.state.relayMissing
              ? "تعذّر تأسيس الصوت — خادم TURN غير مُهيّأ"
              : "انقطع الاتصال الصوتي",
          );
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gatheringComplete(pc);
      if (this.disposed) return;

      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("تعذّر تجهيز المكالمة");

      this.patch({ phase: "dialling" });
      const waCallId = await this.placeCall(conversationId, sdp);
      if (this.disposed) return;

      this.patch({ phase: "ringing", waCallId });
      this.listenForAnswer(waCallId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "تعذّر بدء المكالمة";
      this.fail(message);
    }
  }

  private async fetchIce(): Promise<IceResponse> {
    const response = await fetch("/api/calls/ice");
    if (!response.ok) throw new Error("تعذّر تجهيز إعدادات الاتصال");
    return (await response.json()) as IceResponse;
  }

  private async placeCall(conversationId: string, sdp: string): Promise<string> {
    const response = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, sdp }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      call?: { waCallId?: string };
      error?: string;
    };
    if (!response.ok) throw new Error(body.error || "تعذّر بدء المكالمة");

    const waCallId = body.call?.waCallId;
    if (!waCallId) throw new Error("تعذّر بدء المكالمة");
    return waCallId;
  }

  /**
   * Two routes to the same answer, because neither alone is sufficient: the
   * broadcast is instant but can be missed, and the poll is reliable but slow.
   */
  private listenForAnswer(waCallId: string) {
    const supabase = createClient();

    this.channel = supabase
      .channel(`kiara-call:${waCallId}`, { config: { private: true } })
      .on("broadcast", { event: "signal" }, ({ payload }) => {
        const signal = payload as {
          kind?: string;
          sdp?: string;
          status?: string;
        };
        if (signal.kind === "sdp" && signal.sdp) {
          void this.applyAnswer(signal.sdp);
        } else if (signal.kind === "ended") {
          this.patch({
            phase: signal.status === "failed" ? "failed" : "ended",
          });
          void this.dispose();
        } else if (signal.kind === "status" && signal.status === "rejected") {
          this.patch({ phase: "ended", error: "لم تُجب العميلة" });
          void this.dispose();
        }
      })
      .subscribe();

    const deadline = Date.now() + ANSWER_DEADLINE_MS;
    this.pollTimer = setInterval(() => {
      if (this.answerApplied) return;
      if (Date.now() > deadline) {
        this.fail("لم تصل إجابة المكالمة في الوقت المتوقع");
        return;
      }
      void fetch(`/api/calls/${encodeURIComponent(waCallId)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          const call = body?.call as
            | { remoteSdp?: string | null; status?: string }
            | undefined;
          if (call?.remoteSdp) void this.applyAnswer(call.remoteSdp);
          else if (call?.status === "rejected") {
            this.patch({ phase: "ended", error: "لم تُجب العميلة" });
            void this.dispose();
          }
        })
        .catch(() => {
          // A failed poll is not a failed call; the next tick tries again.
        });
    }, POLL_INTERVAL_MS);
  }

  private async applyAnswer(sdp: string): Promise<void> {
    // Both the broadcast and the poll can deliver the same answer; applying it
    // twice throws in the browser's SDP state machine.
    if (this.answerApplied || !this.pc || this.disposed) return;
    this.answerApplied = true;
    this.clearPoll();

    try {
      await this.pc.setRemoteDescription({ type: "answer", sdp });
    } catch (error) {
      console.error("[call] answer rejected by the peer connection", error);
      this.fail("تعذّر تأسيس الصوت");
    }
  }

  private clearPoll() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** Hang up: tell Meta, then tear down locally. */
  async hangUp(): Promise<void> {
    const waCallId = this.state.waCallId;
    if (waCallId) {
      await fetch(`/api/calls/${encodeURIComponent(waCallId)}`, {
        method: "DELETE",
      }).catch(() => {
        // The terminate webhook still reconciles the row.
      });
    }
    if (this.state.phase !== "failed") this.patch({ phase: "ended" });
    await this.dispose();
  }

  /**
   * Release the microphone and the socket. Idempotent, because it runs from
   * hangup, from the ended broadcast, and from React unmount.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    this.clearPoll();
    if (this.channel) {
      void createClient().removeChannel(this.channel);
      this.channel = null;
    }
    // The microphone indicator stays lit until every track is stopped, which
    // is alarming in a spa where the tab sits open all day.
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
    for (const track of this.remoteStream.getTracks()) {
      this.remoteStream.removeTrack(track);
    }
    this.pc?.close();
    this.pc = null;
  }
}
