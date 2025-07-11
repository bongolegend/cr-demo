import { openai } from "./openaiService";
import { ConversationMessage } from "../models/conversations";

/**
 * Determine if the user is done talking based on the conversation
 * @param conversation - The conversation messages
 * @returns Promise<boolean> - True if user is done talking
 */
export async function isUserDoneTalking(conversation: ConversationMessage[]): Promise<boolean> {
  try {
    const assistantMessages = conversation.filter(msg => msg.role === "assistant");
    if (assistantMessages.length === 0) return true;
    const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
    const userMessages = conversation.filter(msg => msg.role === "user");
    if (userMessages.length === 0) return true;
    const lastUserMessage = userMessages[userMessages.length - 1];
    if (!lastAssistantMessage || !lastUserMessage) return true;
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are analyzing a conversation between a life coach and a user.

The coach asks reflection questions like:
- What are your wins for the day?
- What are you going to do differently tomorrow?
- How did you do towards your goals for the week?
- What's on the agenda for tomorrow?

Your task: Determine if the user is done talking after the coach's most recent question.

Rules:
- If the user sounds like they are mid-sentence, return 0 (user is not done)
- If the user didn't finish answering the question, return 0 (user is not done)
- If the user is saying lots of filler words, like "um", "like", "you know", "you know what", etc., return 0 (user is not done)
- If the user's response ends with "that's all" or similar phrases, return 1 (user is done)
- If the user's response is just a single word, like "ok", "yeah", "yes", "no", "maybe", etc., return 1 (user is done)
- If the user's response sounds like a complete idea, spanning multiple sentences, return 1 (user is done)
- Any other case, return 1 (user is done)

Return ONLY: 1 (user done) or 0 (user not done)`
        },
        {
          role: "user",
          content: `Analyze this conversation:\n\nCoach's last message: "${lastAssistantMessage.content}"\n\nUser's last message: "${lastUserMessage.content}"\n\nIs the user done talking? Return 1 or 0.`
        }
      ],
      max_tokens: 5,
      temperature: 0
    });
    const content = response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
    const result = parseInt(content ? content.trim() : '1');
    console.log(result === 1 ? 'User DONE' : 'User NOT DONE');
    return result === 1;
  } catch (error) {
    console.error("Error determining if user is done talking:", error);
    return true;
  }
} 