export type LivenessState =
  | "IDLE"
  | "STARTING"
  | "WAITING_FOR_FACE"
  | "BLINK_REQUIRED"
  | "MOUTH_REQUIRED"
  | "PASSED"
  | "FAILED"
  | "EXPIRED"
  | "ERROR";

export type LivenessChallenge =
  | "BLINK"
  | "MOUTH_OPEN"
  | "COMPLETE"
  | string;

export interface LivenessMetrics {
  face_detected?: boolean;
  blink_score?: number;
  mouth_open_score?: number;
  lighting_mean?: number;
  is_low_light?: boolean;
  texture_variance?: number;
  landmark_z_std?: number;
  is_spoof?: boolean;
  face_in_frame?: boolean;
}

export interface LivenessMessage {
  session_id?: string;
  state?: string;
  challenge?: string;
  challenge_index?: number;
  challenge_passed?: boolean;
  completed_challenges?: string[];
  feedback?: string;
  error?: string;
  error_code?: string;
  metrics?: LivenessMetrics;
  liveness_token?: string | null;
}

export interface LivenessSessionResponse {
  session_id: string;
  expires_at?: string;
  challenges?: string[];
}
