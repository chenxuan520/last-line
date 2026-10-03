// 同时在 Node 与浏览器求值中调用，保持函数自包含。
export function assertUltraPresentation(mapId: string, quality: string, textureNames: readonly string[]): void {
  if (quality === "ultra" && (!textureNames.includes("ultra-town-static-shadows") || !textureNames.includes("ultra-road-surface-mask"))) {
    throw new Error(`Ultra ${mapId} presentation was not constructed`);
  }
}
