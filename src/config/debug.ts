export interface SinglePlayerDebugArguments {
  enabled: boolean;
  viteArguments: string[];
}

export function isSinglePlayerDebugValue(value: unknown): boolean {
  return value === "true";
}

export function singlePlayerDebugEnabledForVite(
  command: "serve" | "build",
  value: unknown,
): boolean {
  return command === "serve" && isSinglePlayerDebugValue(value);
}

export function parseSinglePlayerDebugArguments(arguments_: readonly string[]): SinglePlayerDebugArguments {
  let enabled = false;
  const viteArguments: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? "";
    if (argument.startsWith("--debug=")) {
      enabled = isSinglePlayerDebugValue(argument.slice("--debug=".length));
      continue;
    }
    if (argument === "--debug") {
      const value = arguments_[index + 1];
      if (value === "true" || value === "false") {
        enabled = isSinglePlayerDebugValue(value);
        index += 1;
      }
      continue;
    }
    viteArguments.push(argument);
  }
  return { enabled, viteArguments };
}
