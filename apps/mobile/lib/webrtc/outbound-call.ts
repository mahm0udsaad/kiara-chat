/**
 * Placing a WhatsApp call from the phone.
 *
 * The peer connection lives on this device — media goes straight from here to
 * Meta's servers and never touches our own. The server's only job is to carry
 * two SDP blobs in opposite directions.
 *
 * The sequence, and why it is this way:
 *
 *   1. Fetch ICE servers first. Candidates are gathered against them, so they
 *      have to exist before the peer connection does.
 *   2. Build the offer, then *wait for gathering to finish*. The Calling API
 *      takes one complete SDP; there is nowhere to trickle a late candidate to.
 *      A deadline caps that wait, because gathering against an unreachable
 *      TURN server otherwise hangs until the platform gives up.
 *   3. POST the offer. The response carries Meta's call id, not the answer.
 *   4. The answer arrives on the realtime channel, or from polling the row if
 *      the broadcast landed before this device had subscribed. Whichever wins.
 *
 * A port of the web client's `OutboundCall` with the same state machine, and
 * the same reason for being a class rather than a hook: a call outlives any
 * single render, and teardown has to run exactly once even if the screen
 * unmounts mid-dial — otherwise the customer's phone keeps ringing with nobody
 * on this end.
 *
 * What is different on a phone, and why:
 *   - Audio has a *route*. Earpiece or speaker is a decision someone has to
 *     make; a call that plays out of the earpiece while the phone is on a
 *     table is a call nobody can hear. InCallManager owns that.
 *   - The microphone needs an explicit runtime grant on Android.
 *   - There is no `<audio>` element. Remote audio is played by the native
 *     engine as soon as the track arrives.
 */
import { Platform, PermissionsAndroid } from "react-native";
import InCallManager from "react-native-incall-manager";
import {
  MediaStream,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
  type MediaStreamTrack,
} from "react-native-webrtc";

import { ApiError, apiRequest } from "@/lib/api";
import { rememberedAccessToken, supabase } from "@/lib/supabase";
import type { CallIceConfig, CallRecord } from "@/types/api";

/** How long to wait for ICE gathering before sending what we have. */
const GATHER_DEADLINE_MS = 2500;
/** How long to wait for Meta's SDP answer before giving up on the call. */
const ANSWER_DEADLINE_MS = 20_000;
const POLL_INTERVAL_MS = 1200;

/** Realtime topic for one call's signalling — must match the server's. */
const callChannel = (waCallId: string) => `kiara-call:${waCallId}`;
const CALL_EVENT = "signal";

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
  /** Whether the call is currently routed to the loudspeaker. */
  speaker: boolean;
  muted: boolean;
}

type Listener = (state: CallState) => void;

/**
 * Ask for the microphone before anything else touches it.
 *
 * iOS prompts from inside `getUserMedia`, so there is nothing to do there.
 * Android does not: without this the call would reach `getUserMedia`, be
 * refused, and surface as a generic failure with no prompt the employee could
 * have answered.
 */
async function ensureMicrophone(): Promise<void> {
  if (Platform.OS !== "android") return;

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: "إذن الميكروفون",
      message: "يحتاج كيارا إلى الميكروفون لإجراء المكالمة الصوتية.",
      buttonPositive: "سماح",
      buttonNegative: "إلغاء",
    },
  );
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error("لا يمكن إجراء المكالمة بدون إذن الميكروفون");
  }
}

/**
 * `RTCPeerConnection` extends an event target whose declarations
 * react-native-webrtc 124.0.8 does not ship: `lib/typescript/vendor/` is
 * missing from the published package, so the inherited listener methods are
 * invisible to TypeScript even though they exist at runtime.
 *
 * Narrowed here rather than cast at each call site, so there is one thing to
 * delete when upstream packages its types completely.
 */
type PeerEvents = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

const events = (pc: RTCPeerConnection) => pc as unknown as PeerEvents;

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
      events(pc).removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    // Sending a partial candidate set is better than sending nothing: the host
    // and server-reflexive candidates are usually already in by now, and they
    // are the ones that carry most calls. On a phone that matters more than in
    // a browser — a device on mobile data can gather slowly enough that a
    // strict wait would push past the customer's patience.
    const timer = setTimeout(finish, GATHER_DEADLINE_MS);
    events(pc).addEventListener("icegatheringstatechange", onChange);
  });
}

/** One outbound call, from microphone permission to hangup. */
export class OutboundCall {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private answerApplied = false;
  private disposed = false;
  private audioSessionStarted = false;
  private listeners = new Set<Listener>();

  private state: CallState = {
    phase: "idle",
    waCallId: null,
    error: null,
    relayMissing: false,
    startedAt: null,
    speaker: false,
    muted: false,
  };

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
      await ensureMicrophone();

      const ice = await apiRequest<CallIceConfig>("/calls/ice");
      if (this.disposed) return;
      this.patch({ relayMissing: !ice.relayAvailable });

      // Claim the audio session before the microphone opens, so the ringback
      // and the call itself share one route. Started here rather than on
      // connect because the employee needs to hear the call progressing.
      InCallManager.start({ media: "audio" });
      this.audioSessionStarted = true;
      InCallManager.setForceSpeakerphoneOn(false);

      // Asked for after the ICE fetch so a configuration failure does not light
      // the phone's microphone indicator for nothing.
      this.localStream = (await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })) as MediaStream;
      if (this.disposed) return;

      const pc = new RTCPeerConnection({ iceServers: ice.iceServers });
      this.pc = pc;

      // addTrack creates the sendrecv audio transceiver on its own. Adding an
      // explicit one as well puts a second audio m-line in the offer, which is
      // not what a WhatsApp call negotiates against.
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }

      // Remote audio needs no sink on a phone: the native engine plays the
      // track on the current route as soon as it arrives.
      events(pc).addEventListener("connectionstatechange", () => {
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
      });

      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);
      await gatheringComplete(pc);
      if (this.disposed) return;

      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("تعذّر تجهيز المكالمة");

      this.patch({ phase: "dialling" });
      const { call } = await apiRequest<{ call: CallRecord }>("/calls", {
        method: "POST",
        body: JSON.stringify({ conversationId, sdp }),
      });
      if (this.disposed) return;

      this.patch({ phase: "ringing", waCallId: call.waCallId });
      await this.listenForAnswer(call.waCallId);
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "تعذّر بدء المكالمة";
      this.fail(message);
    }
  }

  /**
   * Two routes to the same answer, because neither alone is sufficient: the
   * broadcast is instant but can be missed, and the poll is reliable but slow.
   */
  private async listenForAnswer(waCallId: string): Promise<void> {
    const token = rememberedAccessToken();
    // Private channels are gated by RLS on `realtime.messages`, which needs the
    // caller's JWT. Without this the subscription is simply refused and the
    // poll below silently becomes the only path — slower, but still a call.
    if (token) await supabase.realtime.setAuth(token);
    if (this.disposed) return;

    this.channel = supabase
      .channel(callChannel(waCallId), { config: { private: true } })
      .on("broadcast", { event: CALL_EVENT }, ({ payload }) => {
        const signal = (payload ?? {}) as {
          kind?: string;
          sdp?: string;
          status?: string;
        };
        if (signal.kind === "sdp" && signal.sdp) {
          void this.applyAnswer(signal.sdp);
        } else if (signal.kind === "ended") {
          this.patch({ phase: signal.status === "failed" ? "failed" : "ended" });
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
      void apiRequest<{ call: CallRecord }>(
        `/calls/${encodeURIComponent(waCallId)}`,
      )
        .then(({ call }) => {
          if (call.remoteSdp) void this.applyAnswer(call.remoteSdp);
          else if (call.status === "rejected") {
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
    // twice throws in the SDP state machine.
    if (this.answerApplied || !this.pc || this.disposed) return;
    this.answerApplied = true;
    this.clearPoll();

    try {
      await this.pc.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp }),
      );
    } catch (error) {
      console.error("[call] answer rejected by the peer connection", error);
      this.fail("تعذّر تأسيس الصوت");
    }
  }

  private clearPoll() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** Earpiece or loudspeaker. Safe before the call connects. */
  setSpeaker(on: boolean): void {
    if (this.disposed) return;
    InCallManager.setForceSpeakerphoneOn(on);
    this.patch({ speaker: on });
  }

  /**
   * Mute by disabling the track rather than stopping it: a stopped track
   * cannot be restarted, so unmuting would need a renegotiation this API has
   * no way to perform.
   */
  setMuted(muted: boolean): void {
    if (this.disposed) return;
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      (track as MediaStreamTrack).enabled = !muted;
    }
    this.patch({ muted });
  }

  /** Hang up: tell Meta, then tear down locally. */
  async hangUp(): Promise<void> {
    const waCallId = this.state.waCallId;
    if (waCallId) {
      await apiRequest(`/calls/${encodeURIComponent(waCallId)}`, {
        method: "DELETE",
      }).catch(() => {
        // The terminate webhook still reconciles the row.
      });
    }
    if (this.state.phase !== "failed") this.patch({ phase: "ended" });
    await this.dispose();
  }

  /**
   * Release the microphone, the audio session and the socket. Idempotent,
   * because it runs from hangup, from the ended broadcast, and from unmount.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    this.clearPoll();
    if (this.channel) {
      void supabase.removeChannel(this.channel);
      this.channel = null;
    }
    // The microphone indicator stays lit until every track is stopped, which is
    // alarming on a phone that sits in a pocket for the rest of the shift.
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
    this.pc?.close();
    this.pc = null;
    if (this.audioSessionStarted) {
      // Hands the route back to the system; without it the phone stays in call
      // audio mode and the next voice note plays through the earpiece.
      InCallManager.stop();
      this.audioSessionStarted = false;
    }
  }
}
