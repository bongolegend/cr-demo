import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from '@fastify/formbody';
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import { getOrCreateUser } from "./services/userService";
import { getOrCreateSession, getSessionByCallSid, updateSessionConversation } from "./services/sessionService";
dotenv.config();

const PORT = process.env['PORT'] ? parseInt(process.env['PORT'] as string) : 8080;
const DOMAIN = process.env['NGROK_URL'] || "localhost";
const WS_URL = `wss://${DOMAIN}/ws`;
const WELCOME_GREETING =
  "Hey, this is your coach. Is now a good time?";
const SYSTEM_PROMPT = `You are a life coach. Be positive and encouraging, but be succinct.

First, tell the user that you're going to ask them a few questions, and ask them to say "that's all" when they're done answering.
Ask the user the following questions, but not word for word:
- What are your wins for the day?
- What are you going to do differently tomorrow?
- What is motivating you right now?
- What are you grateful for?

Once the user has answered all the questions, recap their responses, and tell them you'll check in with them tomorrow.

This conversation is being translated to voice, so answer carefully. When you respond, please spell out all numbers, for example twenty not 20.
Do not include emojis in your responses. Do not include bullet points, asterisks, or special symbols.`;

const openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });

// Track active processing for each session
const activeProcessing = new Map<string, { cancelled: boolean }>();

type Role = "system" | "user" | "assistant";
interface ConversationMessage {
  role: Role;
  content: string;
}

async function pauseTheRightAmountOfTime(conversation: ConversationMessage[]): Promise<null> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Analyze the conversation and determine if the user is done speaking.\n\nRules:\n- If the assistant was previously just asking for confirmation or making small talk, return 0 (no pause)\n- If the assistant asked a real open-ended question and the user is talking about their day, return 10 (pause for 10 seconds)\n\nReturn ONLY a number: 0 or 10.`
        },
        {
          role: "user",
          content: `Analyze this conversation and determine the pause duration (0 or 10):\n\n${conversation.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`
        }
      ],
      max_tokens: 10,
      temperature: 0
    });

    const content = response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
    const pauseDuration = parseInt(content ? content.trim() : '0');
    if (pauseDuration === 10) {
      console.log("Pausing for 10 seconds before responding...");
      await new Promise(resolve => setTimeout(resolve, 10000));
    } else {
      console.log("No pause needed, responding immediately");
    }
    return null;
  } catch (error) {
    console.error("Error determining pause duration:", error);
    return null;
  }
}

async function isUserDoneTalking(conversation: ConversationMessage[]): Promise<boolean> {
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

function combineUserMessagesSinceLastAssistant(conversation: ConversationMessage[]): ConversationMessage[] {
  let lastAssistantIndex = -1;
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  if (lastAssistantIndex === -1) return conversation;
  const userMessagesAfterAssistant: string[] = [];
  for (let i = lastAssistantIndex + 1; i < conversation.length; i++) {
    if (conversation[i].role === "user") {
      userMessagesAfterAssistant.push(conversation[i].content);
    }
  }
  if (userMessagesAfterAssistant.length === 0) return conversation;
  const newConversation = conversation.slice(0, lastAssistantIndex + 1);
  newConversation.push({
    role: "user",
    content: userMessagesAfterAssistant.join(" ")
  });
  console.log(`Combined ${userMessagesAfterAssistant.length} user messages into one: "${userMessagesAfterAssistant.join(" ")}"`);
  return newConversation;
}

async function aiResponseStream(conversation: ConversationMessage[], ws: any, processingToken: { cancelled: boolean }) {
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

const fastify: FastifyInstance = Fastify();
fastify.register(fastifyWs);
fastify.register(fastifyFormBody);
fastify.all("/twiml", async (request: FastifyRequest, reply: FastifyReply) => {
  reply.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n    <Response>\n      <Connect>\n        <ConversationRelay url="${WS_URL}" welcomeGreeting="${WELCOME_GREETING}" />\n      </Connect>\n    </Response>`
  );
});

fastify.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, async (ws: any, req: any) => {
    ws.on("message", async (data: string) => {
      const message = JSON.parse(data);
      switch (message.type) {
        case "setup": {
          const callSid: string = message.callSid;
          console.log("Setup for call:", callSid);
          ws.callSid = callSid;
          const phoneNumber: string = message.phoneNumber || "default";
          if (!ws.id) {
            ws.id = Math.random().toString(36).slice(2); // fallback id
          }
          const user = await getOrCreateUser(phoneNumber);
          const session = await getOrCreateSession(user.id, callSid, ws.id);
          if (!session.conversation || session.conversation.length === 0) {
            session.conversation = [{ role: "system", content: SYSTEM_PROMPT }];
            await updateSessionConversation(session.id, session.conversation);
          }
          break;
        }
        case "prompt": {
          console.log("Received user input:", message.voicePrompt);
          if (!ws.callSid) {
            console.error("ws.callSid is undefined");
            break;
          }
          const sessionData = await getSessionByCallSid(ws.callSid);
          if (sessionData && sessionData.conversation) {
            const updatedConversation = [...sessionData.conversation, {
              role: "user",
              content: message.voicePrompt,
            }];
            const existingProcessing = activeProcessing.get(ws.callSid);
            if (existingProcessing) {
              console.log("Cancelling previous processing...");
              existingProcessing.cancelled = true;
            }
            const processingToken = { cancelled: false };
            activeProcessing.set(ws.callSid, processingToken);
            const combinedConversation = combineUserMessagesSinceLastAssistant(updatedConversation);
            await updateSessionConversation(sessionData.id, combinedConversation);
            const userDone = await isUserDoneTalking(combinedConversation);
            if (!userDone) {
              console.log("Waiting 10 seconds...");
              for (let i = 10; i > 0; i--) {
                if (processingToken.cancelled) {
                  console.log("Processing cancelled, stopping countdown");
                  return;
                }
                console.log(`${i} seconds...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
            aiResponseStream(combinedConversation, ws, processingToken);
          } else {
            console.error("Session not found for call SID:", ws.callSid);
          }
          break;
        }
        case "interrupt": {
          console.log(
            "Handling interruption; last utterance: ",
            message.utteranceUntilInterrupt
          );
          if (!ws.callSid) {
            console.error("ws.callSid is undefined");
            break;
          }
          await handleInterrupt(ws.callSid, message.utteranceUntilInterrupt);
          break;
        }
        default:
          console.warn("Unknown message type received:", message.type);
          break;
      }
    });
    ws.on("close", () => {
      console.log("WebSocket connection closed");
      if (ws.callSid) {
        activeProcessing.delete(ws.callSid);
      }
    });
  });
});

async function handleInterrupt(callSid: string, utteranceUntilInterrupt: string) {
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

fastify.listen({ port: PORT }).then(() => {
  console.log(
    `Server running at http://localhost:${PORT} and wss://${DOMAIN}/ws`
  );
}).catch((err) => {
  fastify.log.error(err);
  process.exit(1);
}); 