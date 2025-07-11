import { openai } from "./openaiService";
import { getSessionByCallSid, updateSessionConversation } from "./sessionService";
import { ConversationMessage } from "../models/conversations";

/**
 * Stream AI response to user and update session conversation
 * @param conversation - The conversation messages
 * @param ws - WebSocket connection
 * @param processingToken - Token to track if processing was cancelled
 */
export async function streamRespondToUserWithAI(conversation: ConversationMessage[], ws: any, processingToken: { cancelled: boolean }) {
  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: conversation,
    stream: true,
  });
  const assistantSegments: string[] = [];
  for await (const chunk of stream as any) {
    if (processingToken && processingToken.cancelled) {
      console.log("Processing cancelled during streaming, stopping response");
      return;
    }
    let content = "";
    if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && typeof chunk.choices[0].delta.content === 'string') {
      content = chunk.choices[0].delta.content;
    }
    ws.send(
      JSON.stringify({
        type: "text",
        token: content,
        last: false,
      })
    );
    assistantSegments.push(content);
  }
  ws.send(
    JSON.stringify({
      type: "text",
      token: "",
      last: true,
    })
  );
  const sessionData = await getSessionByCallSid(ws.callSid);
  if (sessionData && Array.isArray(sessionData.conversation)) {
    const updatedConversation = [...sessionData.conversation, {
      role: "assistant",
      content: assistantSegments.join("")
    }];
    await updateSessionConversation(sessionData.id, updatedConversation);
    console.log("Assistant message:", JSON.stringify(assistantSegments.join("")));
  } else {
    console.error("Session not found for call SID:", ws.callSid);
  }
} 