import { JSONRPCErrorException } from "json-rpc-2.0";
import { OBS_EVENTS } from "@module-obs/shared/obs";
import { callObs, setDesiredEvents } from "./agents";
import type { WsClient } from "./ws";

// ---------------------------------------------------------------------------
// JSON-RPC methods registered on the hub connection, per account.
// Each method maps to an obs-websocket request proxied through the account's
// browser agent. Responses and event payloads are both passed through
// unchanged, so every field keeps the obs-websocket camelCase name used by
// the protocol docs. Param names follow suit: each one is read under the
// exact obs-websocket field name it maps to, with no aliases.
// ---------------------------------------------------------------------------

interface AccountLike {
  accountId: string;
  subscriptions: Map<string, string>; // subId → rpc event name
}

type Params = Record<string, unknown>;

function missing(name: string): JSONRPCErrorException {
  return new JSONRPCErrorException(`Missing parameter '${name}'`, -32602);
}

function asObject(params: unknown): Params {
  // Hub calls with an object; tolerate a single positional object too.
  if (params && typeof params === "object" && !Array.isArray(params)) return params as Params;
  if (Array.isArray(params) && params[0] && typeof params[0] === "object") return params[0] as Params;
  return {};
}

function optStr(p: Params, name: string): string | undefined {
  const v = p[name];
  return typeof v === "string" && v !== "" ? v : undefined;
}

function reqStr(p: Params, name: string): string {
  const v = optStr(p, name);
  if (v === undefined) throw missing(name);
  return v;
}

function optNum(p: Params, name: string): number | undefined {
  const v = p[name];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function reqNum(p: Params, name: string): number {
  const v = optNum(p, name);
  if (v === undefined) throw missing(name);
  return v;
}

function reqBool(p: Params, name: string): boolean {
  const v = p[name];
  if (typeof v !== "boolean") throw missing(name);
  return v;
}

type ObsMethodDef = (p: Params) => { requestType: string; requestData?: Record<string, unknown> };

// rpc method name → obs-websocket request mapping
const OBS_METHODS: Record<string, ObsMethodDef> = {
  // General
  "general.get_version": () => ({ requestType: "GetVersion" }),
  "general.get_stats": () => ({ requestType: "GetStats" }),
  "general.trigger_hotkey": (p) => ({
    requestType: "TriggerHotkeyByName",
    requestData: { hotkeyName: reqStr(p, "hotkeyName") },
  }),

  // Studio mode
  "studio.get_mode": () => ({ requestType: "GetStudioModeEnabled" }),
  "studio.set_mode": (p) => ({
    requestType: "SetStudioModeEnabled",
    requestData: { studioModeEnabled: reqBool(p, "studioModeEnabled") },
  }),

  // Scenes
  "scene.list": () => ({ requestType: "GetSceneList" }),
  "scene.get_current": () => ({ requestType: "GetCurrentProgramScene" }),
  "scene.set_current": (p) => ({
    requestType: "SetCurrentProgramScene",
    requestData: { sceneName: reqStr(p, "sceneName") },
  }),
  "scene.get_preview": () => ({ requestType: "GetCurrentPreviewScene" }),
  "scene.set_preview": (p) => ({
    requestType: "SetCurrentPreviewScene",
    requestData: { sceneName: reqStr(p, "sceneName") },
  }),
  "scene.create": (p) => ({
    requestType: "CreateScene",
    requestData: { sceneName: reqStr(p, "sceneName") },
  }),
  "scene.remove": (p) => ({
    requestType: "RemoveScene",
    requestData: { sceneName: reqStr(p, "sceneName") },
  }),

  // Scene items
  "scene_item.list": (p) => ({
    requestType: "GetSceneItemList",
    requestData: { sceneName: reqStr(p, "sceneName") },
  }),
  "scene_item.get_enabled": (p) => ({
    requestType: "GetSceneItemEnabled",
    requestData: {
      sceneName: reqStr(p, "sceneName"),
      sceneItemId: reqNum(p, "sceneItemId"),
    },
  }),
  "scene_item.set_enabled": (p) => ({
    requestType: "SetSceneItemEnabled",
    requestData: {
      sceneName: reqStr(p, "sceneName"),
      sceneItemId: reqNum(p, "sceneItemId"),
      sceneItemEnabled: reqBool(p, "sceneItemEnabled"),
    },
  }),

  // Inputs
  "input.list": (p) => ({
    requestType: "GetInputList",
    requestData: optStr(p, "inputKind") ? { inputKind: optStr(p, "inputKind") } : undefined,
  }),
  "input.get_mute": (p) => ({
    requestType: "GetInputMute",
    requestData: { inputName: reqStr(p, "inputName") },
  }),
  "input.set_mute": (p) => ({
    requestType: "SetInputMute",
    requestData: {
      inputName: reqStr(p, "inputName"),
      inputMuted: reqBool(p, "inputMuted"),
    },
  }),
  "input.toggle_mute": (p) => ({
    requestType: "ToggleInputMute",
    requestData: { inputName: reqStr(p, "inputName") },
  }),
  "input.get_volume": (p) => ({
    requestType: "GetInputVolume",
    requestData: { inputName: reqStr(p, "inputName") },
  }),
  "input.set_volume": (p) => {
    const inputVolumeDb = optNum(p, "inputVolumeDb");
    const inputVolumeMul = optNum(p, "inputVolumeMul");
    if (inputVolumeDb === undefined && inputVolumeMul === undefined) {
      throw new JSONRPCErrorException("Missing parameter 'inputVolumeDb' (or 'inputVolumeMul')", -32602);
    }
    return {
      requestType: "SetInputVolume",
      requestData: {
        inputName: reqStr(p, "inputName"),
        ...(inputVolumeDb !== undefined ? { inputVolumeDb } : {}),
        ...(inputVolumeMul !== undefined ? { inputVolumeMul } : {}),
      },
    };
  },

  // Stream
  "stream.get_status": () => ({ requestType: "GetStreamStatus" }),
  "stream.start": () => ({ requestType: "StartStream" }),
  "stream.stop": () => ({ requestType: "StopStream" }),
  "stream.toggle": () => ({ requestType: "ToggleStream" }),
  "stream.send_caption": (p) => ({
    requestType: "SendStreamCaption",
    requestData: { captionText: reqStr(p, "captionText") },
  }),

  // Record
  "record.get_status": () => ({ requestType: "GetRecordStatus" }),
  "record.start": () => ({ requestType: "StartRecord" }),
  "record.stop": () => ({ requestType: "StopRecord" }),
  "record.toggle": () => ({ requestType: "ToggleRecord" }),
  "record.pause": () => ({ requestType: "PauseRecord" }),
  "record.resume": () => ({ requestType: "ResumeRecord" }),
  "record.toggle_pause": () => ({ requestType: "ToggleRecordPause" }),

  // Replay buffer
  "replay_buffer.get_status": () => ({ requestType: "GetReplayBufferStatus" }),
  "replay_buffer.start": () => ({ requestType: "StartReplayBuffer" }),
  "replay_buffer.stop": () => ({ requestType: "StopReplayBuffer" }),
  "replay_buffer.toggle": () => ({ requestType: "ToggleReplayBuffer" }),
  "replay_buffer.save": () => ({ requestType: "SaveReplayBuffer" }),

  // Media inputs
  "media.get_status": (p) => ({
    requestType: "GetMediaInputStatus",
    requestData: { inputName: reqStr(p, "inputName") },
  }),
  "media.play": (p) => mediaAction(p, "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY"),
  "media.pause": (p) => mediaAction(p, "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE"),
  "media.restart": (p) => mediaAction(p, "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART"),
  "media.stop": (p) => mediaAction(p, "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP"),
  "media.next": (p) => mediaAction(p, "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT"),
  "media.previous": (p) => mediaAction(p, "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS"),
  "media.set_time": (p) => ({
    requestType: "SetMediaInputCursor",
    requestData: {
      inputName: reqStr(p, "inputName"),
      mediaCursor: reqNum(p, "mediaCursor"),
    },
  }),

  // Transitions
  "transition.list": () => ({ requestType: "GetSceneTransitionList" }),
  "transition.get_current": () => ({ requestType: "GetCurrentSceneTransition" }),
  "transition.set_current": (p) => ({
    requestType: "SetCurrentSceneTransition",
    requestData: { transitionName: reqStr(p, "transitionName") },
  }),
  "transition.set_duration": (p) => ({
    requestType: "SetCurrentSceneTransitionDuration",
    requestData: { transitionDuration: reqNum(p, "transitionDuration") },
  }),
  "transition.trigger": () => ({ requestType: "TriggerStudioModeTransition" }),

  // Source filters
  "filter.list": (p) => ({
    requestType: "GetSourceFilterList",
    requestData: { sourceName: reqStr(p, "sourceName") },
  }),
  "filter.set_enabled": (p) => ({
    requestType: "SetSourceFilterEnabled",
    requestData: {
      sourceName: reqStr(p, "sourceName"),
      filterName: reqStr(p, "filterName"),
      filterEnabled: reqBool(p, "filterEnabled"),
    },
  }),

  // Virtual camera
  "virtual_cam.get_status": () => ({ requestType: "GetVirtualCamStatus" }),
  "virtual_cam.start": () => ({ requestType: "StartVirtualCam" }),
  "virtual_cam.stop": () => ({ requestType: "StopVirtualCam" }),
  "virtual_cam.toggle": () => ({ requestType: "ToggleVirtualCam" }),

  // Screenshot (returns { imageData } — base64 data URL)
  "screenshot.get": (p) => ({
    requestType: "GetSourceScreenshot",
    requestData: {
      sourceName: reqStr(p, "sourceName"),
      imageFormat: optStr(p, "imageFormat") ?? "png",
      ...(optNum(p, "imageWidth") !== undefined
        ? { imageWidth: optNum(p, "imageWidth") }
        : {}),
      ...(optNum(p, "imageHeight") !== undefined
        ? { imageHeight: optNum(p, "imageHeight") }
        : {}),
    },
  }),
};

function mediaAction(p: Params, mediaAction: string): { requestType: string; requestData: Record<string, unknown> } {
  return {
    requestType: "TriggerMediaInputAction",
    requestData: {
      inputName: reqStr(p, "inputName"),
      mediaAction,
    },
  };
}

export function registerMethods(client: WsClient, conn: AccountLike): void {
  client.rpc.addMethod("ping", () => "pong");

  // Hub-driven event subscriptions (positional: [eventName] → subId | null)
  client.rpc.addMethod("event.subscribe", (params: unknown) => {
    const name = Array.isArray(params) && typeof params[0] === "string" ? params[0] : null;
    if (!name || !(name in OBS_EVENTS)) return null;

    for (const [, existing] of conn.subscriptions) {
      if (existing === name) return null; // already subscribed
    }

    const subId = crypto.randomUUID();
    conn.subscriptions.set(subId, name);
    setDesiredEvents(conn.accountId, new Set(conn.subscriptions.values()));
    return subId;
  });

  client.rpc.addMethod("event.unsubscribe", (params: unknown) => {
    const subId = Array.isArray(params) && typeof params[0] === "string" ? params[0] : null;
    if (subId && conn.subscriptions.delete(subId)) {
      setDesiredEvents(conn.accountId, new Set(conn.subscriptions.values()));
    }
    return true;
  });

  // OBS proxy methods
  for (const [rpcName, def] of Object.entries(OBS_METHODS)) {
    client.rpc.addMethod(rpcName, async (params: unknown) => {
      const { requestType, requestData } = def(asObject(params));
      return callObs(conn.accountId, requestType, requestData);
    });
  }

  // Generic passthrough: obs.call({ requestType, requestData? })
  client.rpc.addMethod("obs.call", async (params: unknown) => {
    const p = asObject(params);
    const requestType = reqStr(p, "requestType");
    const requestData =
      p.requestData && typeof p.requestData === "object" && !Array.isArray(p.requestData)
        ? (p.requestData as Record<string, unknown>)
        : undefined;
    return callObs(conn.accountId, requestType, requestData);
  });
}
