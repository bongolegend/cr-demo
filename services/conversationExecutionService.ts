import { openai } from "./openaiService";
import { getSessionByCallSid, updateSessionConversation } from "./sessionService";
import { ConversationMessage } from "../models/conversations";

/**
 * Ask the user if they are done talking
 * @param ws - WebSocket connection
 * @param sessionData - The session data
 */
export async function askUserIfDoneTalking(ws: any, sessionData: any) {
  const doneMessage = "Are you done with that question?";
  
  ws.send(
    JSON.stringify({
      type: "text",
      token: doneMessage,
      last: true,
    })
  );
  
  // Add the assistant message to the conversation
  const updatedConversation = [...sessionData.conversation, {
    role: "assistant",
    content: doneMessage
  }];
  
  // Update the session with the new conversation
  await updateSessionConversation(sessionData.id, updatedConversation);
  
  console.log("Asked user if they are done talking");
}

/**
 * Stream AI response to user and update session conversation
 * @param sessionData - The session data
 * @param ws - WebSocket connection
 * @param processingToken - Token to track if processing was cancelled
 */
export async function respondToUser(sessionData: any, ws: any, processingToken: { cancelled: boolean }) {
  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: sessionData.conversation,
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
  
  // Add the assistant message to the conversation
  const updatedConversation = [...sessionData.conversation, {
    role: "assistant",
    content: assistantSegments.join("")
  }];
  
  // Update the session with the new conversation
  await updateSessionConversation(sessionData.id, updatedConversation);
  console.log("Assistant message:", JSON.stringify(assistantSegments.join("")));
}

