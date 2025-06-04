import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormbody from "@fastify/formbody";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.NGROK_URL;
const WS_URL = `wss://${DOMAIN}/ws`;
const WELCOME_GREETING =
  "Hi! Thank you for calling Wiggles Veterinary. How can I help you today?";
const SYSTEM_PROMPT = `You are a helpful assistant for a veterinary clinic, so you will be asked about animal care, appointments, and other related topics.
  This conversation is being translated to voice, so answer carefully.
  When you respond, please spell out all numbers, for example twenty not 20. Do not include emojis in your responses. 
  Do not include bullet points, asterisks, or special symbols.
    
  Make sure you get the pet's name, the owner's name, and the type of animal (dog, cat, etc.) if relevant.
  If someone asks for an appointment call the "get_appointments" function to fetch appointment options.`;
const sessions = new Map();

import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

import axios from "axios";
const tools = [
  {
    type: "function",
    function: {
      name: "find_appointments",
      description:
        "Find available appointments based on user preferences, such as mornings or a specific week.",
      parameters: {
        type: "object",
        properties: {
          preferences: {
            type: "string",
            description:
              "Preferences for appointment search, e.g., 'mornings, week of june ninth'.",
          },
        },
        required: ["preferences"],
      },
    },
  },
];

async function getAppointments(preferences) {
  const response = await axios.get(
    `https://appointment-finder-4175.twil.io/appointments?preferences=${encodeURIComponent(
      preferences
    )}`
  );
  const data = response.data;
  return data.availableAppointments
    .map((appointment) => appointment.displayTime)
    .join(", ");
}

async function aiResponseStream(messages, ws) {
  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: messages,
    stream: true,
    tools: tools,
  });

  const finalToolCalls = {};
  const assistantSegments = [];
  console.log("Received response chunks:");
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";

    // Send each token
    console.log(content);
    ws.send(
      JSON.stringify({
        type: "text",
        token: content,
        last: false,
      })
    );
    assistantSegments.push(content);

    // Call functions if tool calls are present
    const toolCalls = chunk.choices[0].delta.tool_calls || [];
    const finishReason = chunk.choices[0].finish_reason;

    // Accumulate function arguments
    // See: https://platform.openai.com/docs/guides/function-calling?api-mode=chat#streaming
    for (const toolCall of toolCalls) {
      const { index } = toolCall;

      if (!finalToolCalls[index]) {
        finalToolCalls[index] = toolCall;
      }

      finalToolCalls[index].function.arguments += toolCall.function.arguments;
    }

    if (finishReason === "tool_calls") {
      for (const toolCallIdx in finalToolCalls) {
        const toolCall = finalToolCalls[toolCallIdx];
        try {
          const parsedArgs = JSON.parse(toolCall.function.arguments);
          console.log("Calling tool:", toolCall.function.name, parsedArgs);
          const result = await getAppointments(parsedArgs.preferences);
          const toolResponse =
            "We found the following appointment options: " + result;

          ws.send(
            JSON.stringify({
              type: "text",
              token: toolResponse,
              last: false,
            })
          );
          console.log(toolResponse);

          assistantSegments.push(toolResponse);
        } catch (err) {
          console.error("Error processing tool call:", err);
        }
      }
    }
  }

  const finalResponse = assistantSegments.join("");
  console.log("Assistant response complete:", finalResponse);
  messages.push({
    role: "assistant",
    content: finalResponse,
  });
}

const fastify = Fastify({ logger: true });
fastify.register(fastifyWs);
fastify.register(fastifyFormbody);
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
          sessions.set(callSid, [{ role: "system", content: SYSTEM_PROMPT }]);
          break;
        case "prompt":
          console.log("Processing prompt:", message.voicePrompt);

          const messages = sessions.get(ws.callSid);
          messages.push({ role: "user", content: message.voicePrompt });

          await aiResponseStream(messages, ws);

          // Send the final "last" token when streaming completes
          ws.send(
            JSON.stringify({
              type: "text",
              token: "",
              last: true,
            })
          );
          break;
        default:
          console.warn("Unknown message type received:", message.type);
          break;
      }
    });

    ws.on("close", () => {
      console.log("WebSocket connection closed");
      sessions.delete(ws.callSid);
    });
  });
});

try {
  fastify.listen({ port: PORT });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
