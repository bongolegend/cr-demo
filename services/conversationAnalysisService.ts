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
          content: `You are analyzing a conversation between a life coach and a user. \n\nThe coach asks reflection questions like:\n- What are your wins for the day?\n- What are you most proud of?\n- What are you going to do differently tomorrow?\n- How did you do towards your goals for the week?\n- What's on the agenda for tomorrow?\n- What is your why?\n- What are you grateful for?\n\nYour task: Determine if the user is done talking after the coach's most recent question.\n\nRules:\n- If the user sounds like they are mid-sentence, return 0 (user is not done)\n- If the coach's last message was one of these questions AND the user's response doesn't end with phrases like \"that's all\", \"that's it\", \"that's everything\", \"nothing else\", etc., return 0 (user is not done)\n- If the user's response ends with \"that's all\" or similar phrases, return 1 (user is done)\n\nReturn ONLY: 1 (user done) or 0 (user not done)`
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