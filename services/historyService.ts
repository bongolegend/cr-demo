import { openai } from "./openaiService";
import { getSessionByCallSid, updateSession } from "./sessionService";
import { ConversationMessage } from "../models/conversations";

/**
 * Summarize a conversation using OpenAI and save it to the session
 * @param callSid - The Twilio call SID
 * @returns Promise<void>
 */
export async function summarizeConversation(callSid: string): Promise<void> {
  try {
    console.log(`Summarizing conversation for call: ${callSid}`);
    
    // Get the session with conversation data
    const session = await getSessionByCallSid(callSid);
    if (!session || !session.conversation || session.conversation.length === 0) {
      console.log(`No conversation found for call: ${callSid}`);
      return;
    }

    // Filter out system messages and get only user and assistant messages
    const conversationMessages = session.conversation.filter(
      (msg: ConversationMessage) => msg.role === "user" || msg.role === "assistant"
    );

    if (conversationMessages.length === 0) {
      console.log(`No user/assistant messages found for call: ${callSid}`);
      return;
    }

    // Get session creation time for context
    const sessionDate = session.created_at;
    const dateStr = sessionDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const timeStr = sessionDate.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });

    // Create a readable conversation format for summarization
    const conversationText = conversationMessages
      .map((msg: ConversationMessage) => `${msg.role === "user" ? "User" : "Coach"}: ${msg.content}`)
      .join("\n\n");

    // Generate summary using OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a factual summarizer of life coaching conversations. 
          
Create a direct, factual summary using these categories:

**Goals**: List each goal mentioned by the client, numbered (1, 2, 3...)

**Progress**: State what the client reported they accomplished or tried

**Blockers**: List specific obstacles or challenges the client mentioned

**Trends**: Note any patterns the client described in their behavior

**Insights**: Record any realizations or learnings the client expressed

**Actions**: List specific next steps the client committed to

**Assessment**: Brief factual statement about the session

Be direct and factual. Avoid interpretation or creative language. Use bullet points where appropriate.`
        },
        {
          role: "user",
          content: `Please summarize this life coaching conversation that took place on ${dateStr} at ${timeStr}:\n\n${conversationText}`
        }
      ],
      max_tokens: 500,
      temperature: 0.3
    });

    const summary = response.choices?.[0]?.message?.content?.trim() || "No summary available";
    
    console.log(`Generated summary for call ${callSid}: ${summary}`);

    // Update the session with the summary
    await updateSession(session.id, { summary });
    
    console.log(`Summary saved to session ${session.id}`);
  } catch (error) {
    console.error(`Error summarizing conversation for call ${callSid}:`, error);
  }
} 