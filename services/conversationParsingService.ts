import { ConversationMessage } from "../models/conversations";
import { getSessionByCallSid, updateSessionConversation } from "./sessionService";

/**
 * Combine multiple user messages since the last assistant message into a single message
 * @param sessionData - The session data
 * @returns ConversationMessage[] - The conversation with combined user messages
 */
export async function combineUserMessagesSinceLastAssistant(sessionData: any): Promise<ConversationMessage[]> {
  const conversation = sessionData.conversation;
  let lastAssistantIndex = -1;
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i]?.role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  if (lastAssistantIndex === -1) return conversation;
  const userMessagesAfterAssistant: string[] = [];
  for (let i = lastAssistantIndex + 1; i < conversation.length; i++) {
    if (conversation[i]?.role === "user") {
      userMessagesAfterAssistant.push(conversation[i]?.content || "");
    }
  }
  if (userMessagesAfterAssistant.length === 0) return conversation;
  const newConversation = conversation.slice(0, lastAssistantIndex + 1);
  newConversation.push({
    role: "user",
    content: userMessagesAfterAssistant.join(" ")
  });
  console.log(`Combined ${userMessagesAfterAssistant.length} user messages into one: "${userMessagesAfterAssistant.join(" ")}"`);
  
  // Update the session with the combined conversation
  await updateSessionConversation(sessionData.id, newConversation);
  
  return newConversation;
}

/**
 * Handle interruption in conversation by truncating the interrupted message
 * @param callSid - The call SID
 * @param utteranceUntilInterrupt - The utterance that caused the interruption
 */
export async function handleInterrupt(callSid: string, utteranceUntilInterrupt: string) {
  const sessionData = await getSessionByCallSid(callSid);
  if (sessionData && Array.isArray(sessionData.conversation)) {
    const conversation = sessionData.conversation;
    let updatedConversation = [...conversation];
    const interruptedIndex = updatedConversation.findIndex(
      (message: ConversationMessage) =>
        message.role === "assistant" &&
        message.content &&
        message.content.includes(utteranceUntilInterrupt)
    );
    if (interruptedIndex !== -1) {
      const interruptedMessage = updatedConversation[interruptedIndex];
      const interruptPosition = interruptedMessage.content.indexOf(
        utteranceUntilInterrupt
      );
      const truncatedContent = interruptedMessage.content.substring(
        0,
        interruptPosition + utteranceUntilInterrupt.length
      );
      updatedConversation[interruptedIndex] = {
        ...interruptedMessage,
        content: truncatedContent,
      };
      updatedConversation = updatedConversation.filter(
        (message, index) =>
          !(index > interruptedIndex && message.role === "assistant")
      );
    }
    await updateSessionConversation(sessionData.id, updatedConversation);
  } else {
    console.error("Session not found for call SID:", callSid);
  }
} 