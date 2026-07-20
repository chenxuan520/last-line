import type { PublicRoomSummary, RoomAdmission, RoomVisibility } from "../src/network/protocol";

export interface GuestRecord {
  playerId: string;
  sessionToken: string;
  displayName: string;
  accountId: string | null;
  accountSessionRevision: number | null;
  createdAt: number;
}

export interface RoomMemberRecord {
  playerId: string;
  displayName: string;
  accountId: string | null;
  accountSessionRevision: number | null;
  admissionToken: string;
  admissionExpiresAt: number;
  admissionConsumed: boolean;
  reconnectToken: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
  joinedAt: number;
  connectionEpoch: number;
  actorId: string | null;
}

export interface RoomOptions {
  startWithBandage: boolean;
  disableAiSnipers: boolean;
}

export interface RoomInitialization {
  roomId: string;
  code: string;
  visibility: RoomVisibility;
  host: GuestRecord;
  options: RoomOptions;
}

export interface RoomJoinRequest {
  guest: GuestRecord;
}

export interface RoomMutationResult {
  admission: RoomAdmission;
  summary: PublicRoomSummary;
}
