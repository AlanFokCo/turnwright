/** Slash command registry. Commands are TUI-local; engine interaction goes
 *  through the LCP client. */

export interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help", description: "list commands" },
  { name: "/model", description: "switch model", usage: "/model [name]" },
  { name: "/sessions", description: "resume a saved session" },
  { name: "/theme", description: "switch theme", usage: "/theme [name]" },
  { name: "/permission", description: "set permission mode", usage: "/permission <mode>" },
  { name: "/status", description: "show session status" },
  { name: "/vim", description: "toggle vim keybindings" },
  { name: "/compact", description: "compact context (pending upstream API)" },
  { name: "/clear", description: "clear the conversation view" },
  { name: "/quit", description: "exit" },
];

export function completeSlash(prefix: string): SlashCommand[] {
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(prefix));
}
