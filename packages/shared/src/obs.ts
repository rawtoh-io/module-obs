// ── OBS events exposed on the Rawtoh hub ────────────────────────────
// Maps the Rawtoh RPC event name (snake_case, emitted to the hub) to the
// obs-websocket v5 event name the browser agent subscribes to.
// The browser forwards obs-websocket payloads unchanged (camelCase); the
// backend converts keys to snake_case before emitting to the hub.

export const OBS_EVENTS: Record<string, string> = {
  "scene.current_changed": "CurrentProgramSceneChanged",
  "scene.preview_changed": "CurrentPreviewSceneChanged",
  "scene.list_changed": "SceneListChanged",
  "scene.created": "SceneCreated",
  "scene.removed": "SceneRemoved",
  "scene.name_changed": "SceneNameChanged",
  "scene_item.enable_state_changed": "SceneItemEnableStateChanged",
  "input.mute_state_changed": "InputMuteStateChanged",
  "input.volume_changed": "InputVolumeChanged",
  "input.created": "InputCreated",
  "input.removed": "InputRemoved",
  "input.name_changed": "InputNameChanged",
  "stream.state_changed": "StreamStateChanged",
  "record.state_changed": "RecordStateChanged",
  "replay_buffer.state_changed": "ReplayBufferStateChanged",
  "transition.current_changed": "CurrentSceneTransitionChanged",
  "transition.started": "SceneTransitionStarted",
  "transition.ended": "SceneTransitionEnded",
  "filter.enable_state_changed": "SourceFilterEnableStateChanged",
  "studio_mode.state_changed": "StudioModeStateChanged",
  "virtual_cam.state_changed": "VirtualcamStateChanged",
  "exit.started": "ExitStarted",
};

// ── Agent protocol (browser ↔ module backend, JSON over WebSocket) ──
// ONE WebSocket per browser tab (per org) multiplexes every OBS
// connection: the browser holds N obs-websocket connections (one per
// attached account) and every message carries its `accountId`.
//
// The browser drives attachment: `attach` starts bridging an account
// (the backend answers with `connect` — OBS credentials never touch
// browser storage), `detach` stops it. The socket closes when the last
// account is detached.

export type ObsAgentState = "disconnected" | "connecting" | "connected" | "error";

/** Messages sent by the backend to the browser agent. */
export type ServerToAgent =
  | { type: "connect"; accountId: string; host: string; port: number; password: string }
  | { type: "disconnect"; accountId: string }
  | { type: "call"; accountId: string; id: string; requestType: string; requestData?: Record<string, unknown> }
  | { type: "set-events"; accountId: string; events: string[] };

/** Messages sent by the browser agent to the backend. */
export type AgentToServer =
  | { type: "attach"; accountId: string }
  | { type: "detach"; accountId: string }
  | { type: "obs-state"; accountId: string; state: ObsAgentState; error?: string }
  | { type: "result"; accountId: string; id: string; ok: boolean; data?: unknown; error?: string }
  | { type: "event"; accountId: string; event: string; data: unknown };
