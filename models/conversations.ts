export type Role = "system" | "user" | "assistant";

export interface ConversationMessage {
  role: Role;
  content: string;
} 