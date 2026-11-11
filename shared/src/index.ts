export const PROTOCOL_VERSION = 1 as const;

export interface RequestEnvelope<TPayload = unknown> {
  version: typeof PROTOCOL_VERSION;
  type: "request";
  id: string;
  action: string;
  payload: TPayload;
}

export interface ResponseEnvelope<TPayload = unknown> {
  version: typeof PROTOCOL_VERSION;
  type: "response";
  id: string;
  ok: boolean;
  payload?: TPayload;
  error?: { code: string; message: string };
}

export interface HealthPayload {
  status: "ok";
  service: "secure-transfer-server";
}
