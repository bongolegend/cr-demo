import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from '@fastify/formbody';
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
dotenv.config();

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.NGROK_URL;
const WS_URL = `wss://${DOMAIN}/ws`;
const WELCOME_GREETING =
  "Hey, this is your coach. Is now a good time?";
const SYSTEM_PROMPT = `You are a life coach. Be positive and encouraging, but be succinct. 

Ask the user the following questions, but not word for word.
- What are your wins for the day?
- What are you going to do differently tomorrow?
- What is motivating you right now?
- What are you grateful for?

Once the user has answered all the questions, recap their responses, and tell them you'll check in with them tomorrow.

This conversation is being translated to voice, so answer carefully. When you respond, please spell out all numbers, for example twenty not 20. 
Do not include emojis in your responses. Do not include bullet points, asterisks, or special symbols.`;
const sessions = new Map();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Track active processing for each session
const activeProcessing = new Map();


async function pauseTheRightAmountOfTime(conversation) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Analyze the conversation and determine if the user is done speaking.

Rules:
- If the assistant was previously just asking for confirmation or making small talk, return 0 (no pause)
- If the assistant asked a real open-ended question and the user is talking about their day, return 10 (pause for 10 seconds)

Return ONLY a number: 0 or 10.`
        },
        {
          role: "user",
          content: `Analyze this conversation and determine the pause duration (0 or 10):

${conversation.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`
        }
      ],
      max_tokens: 10,
      temperature: 0
    });

    const pauseDuration = parseInt(response.choices[0].message.content.trim());
    
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

async function isUserDoneTalking(conversation) {
  try {
    // Get the most recent assistant message
    const assistantMessages = conversation.filter(msg => msg.role === "assistant");
    if (assistantMessages.length === 0) {
      return true; // No assistant message, proceed normally
    }
    
    const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
    
    // Get the most recent user message
    const userMessages = conversation.filter(msg => msg.role === "user");
    if (userMessages.length === 0) {
      return true; // No user message, proceed normally
    }
    
    const lastUserMessage = userMessages[userMessages.length - 1];
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are analyzing a conversation between a life coach and a user. 

The coach asks reflection questions like:
- What are your wins for the day?
- What are you most proud of?
- What are you going to do differently tomorrow?
- How did you do towards your goals for the week?
- What's on the agenda for tomorrow?
- What is your why?
- What are you grateful for?

Your task: Determine if the user is done talking after the coach's most recent question.

Rules:
- If the user sounds like they are mid-sentence, return 0 (user is not done)
- If the coach's last message was one of these questions AND the user's response doesn't end with phrases like "that's all", "that's it", "that's everything", "nothing else", etc., return 0 (user is not done)
- If the user's response ends with "that's all" or similar phrases, return 1 (user is done)

Return ONLY: 1 (user done) or 0 (user not done)`
        },
        {
          role: "user",
          content: `Analyze this conversation:

Coach's last message: "${lastAssistantMessage.content}"

User's last message: "${lastUserMessage.content}"

Is the user done talking? Return 1 or 0.`
        }
      ],
      max_tokens: 5,
      temperature: 0
    });

    const result = parseInt(response.choices[0].message.content.trim());
    console.log(result === 1 ? 'User DONE' : 'User NOT DONE');
    
    return result === 1;
  } catch (error) {
    console.error("Error determining if user is done talking:", error);
    return true; // Default to proceeding if there's an error
  }
}

function combineUserMessagesSinceLastAssistant(conversation) {
  // Find the index of the last assistant message
  let lastAssistantIndex = -1;
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  
  // If no assistant message found, return the conversation as is
  if (lastAssistantIndex === -1) {
    return conversation;
  }
  
  // Collect all user messages after the last assistant message
  const userMessagesAfterAssistant = [];
  for (let i = lastAssistantIndex + 1; i < conversation.length; i++) {
    if (conversation[i].role === "user") {
      userMessagesAfterAssistant.push(conversation[i].content);
    }
  }
  
  // If no user messages after assistant, return conversation as is
  if (userMessagesAfterAssistant.length === 0) {
    return conversation;
  }
  
  // Create new conversation with combined user message
  const newConversation = conversation.slice(0, lastAssistantIndex + 1);
  
  // Add the combined user message
  newConversation.push({
    role: "user",
    content: userMessagesAfterAssistant.join(" ")
  });
  
  console.log(`Combined ${userMessagesAfterAssistant.length} user messages into one: "${userMessagesAfterAssistant.join(" ")}"`);
  
  return newConversation;
}

async function aiResponseStream(conversation, ws, processingToken) {

  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: conversation,
    stream: true,
  });

  const assistantSegments = [];

  for await (const chunk of stream) {
    // Check if processing was cancelled
    if (processingToken && processingToken.cancelled) {
      console.log("Processing cancelled during streaming, stopping response");
      return;
    }
    
    const content = chunk.choices[0]?.delta?.content || "";
  
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

  const sessionData = sessions.get(ws.callSid);
  sessionData.conversation.push({
    role: "assistant",
    content: assistantSegments.join(""),
  });
  console.log(
    "Assistant message:",
    JSON.stringify(assistantSegments.join(""))
  );
}

const fastify = Fastify();
fastify.register(fastifyWs);
fastify.register(fastifyFormBody);
fastify.all("/twiml", async (request, reply) => {
  reply.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <ConversationRelay url="${WS_URL}" welcomeGreeting="${WELCOME_GREETING}" />
      </Connect>
    </Response>`
  );
});

fastify.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, (ws, req) => {
    ws.on("message", async (data) => {
      const message = JSON.parse(data);

      switch (message.type) {
        case "setup":
          const callSid = message.callSid;
          console.log("Setup for call:", callSid);
          ws.callSid = callSid;
          sessions.set(callSid, {
            conversation: [{ role: "system", content: SYSTEM_PROMPT }],
            lastFullResponse: [],
          });
          break;
        case "prompt":
          console.log("Received user input:", message.voicePrompt);
          const sessionData = sessions.get(ws.callSid);
          sessionData.conversation.push({
            role: "user",
            content: message.voicePrompt,
          });

          // Cancel any existing processing for this session
          const existingProcessing = activeProcessing.get(ws.callSid);
          if (existingProcessing) {
            console.log("Cancelling previous processing...");
            existingProcessing.cancelled = true;
          }

          // Create new processing token
          const processingToken = { cancelled: false };
          activeProcessing.set(ws.callSid, processingToken);

          // Combine user messages since last assistant message
          sessionData.conversation = combineUserMessagesSinceLastAssistant(sessionData.conversation);

          const userDone = await isUserDoneTalking(sessionData.conversation);
          if (!userDone) {
            console.log("Waiting 10 seconds...");
            for (let i = 10; i > 0; i--) {
              // Check if processing was cancelled
              if (processingToken.cancelled) {
                console.log("Processing cancelled, stopping countdown");
                return;
              }
              console.log(`${i} seconds...`);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }

          aiResponseStream(sessionData.conversation, ws, processingToken);
          break;
        case "interrupt":
          console.log(
            "Handling interruption; last utterance: ",
            message.utteranceUntilInterrupt
          );
          handleInterrupt(ws.callSid, message.utteranceUntilInterrupt);
          break;
        default:
          console.warn("Unknown message type received:", message.type);
          break;
      }
    });

    ws.on("close", () => {
      console.log("WebSocket connection closed");
      sessions.delete(ws.callSid);
      activeProcessing.delete(ws.callSid);
    });
  });
});

function handleInterrupt(callSid, utteranceUntilInterrupt) {
  const sessionData = sessions.get(callSid);
  const conversation = sessionData.conversation;

  let updatedConversation = [...conversation];

  const interruptedIndex = updatedConversation.findIndex(
    (message) =>
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

  sessionData.conversation = updatedConversation;
  sessions.set(callSid, sessionData);
}

try {
  fastify.listen({ port: PORT });
  console.log(
    `Server running at http://localhost:${PORT} and wss://${DOMAIN}/ws`
  );
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
