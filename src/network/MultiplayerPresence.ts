import type { EntityId } from "../game/state/types";
import type { HumanConnectionEvent } from "./protocol";

export function resolveHumanConnectionNotice(
  event: HumanConnectionEvent,
  localActorId: EntityId,
  displayNames: Readonly<Record<EntityId, string>>,
): string | null {
  if (event.actorId === localActorId) return null;
  const displayName = displayNames[event.actorId];
  if (!displayName) return null;
  return event.status === "disconnected"
    ? `${displayName} 已断开连接`
    : `${displayName} 已重新连接`;
}
