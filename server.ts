import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from '@fastify/formbody';
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import { getOrCreateUser } from "./services/userService";
import { getOrCreateSession, getSessionByCallSid, updateSessionConversation } from "./services/sessionService";
import { isUserDoneTalking } from "./services/conversationAnalysisService";
import { combineUserMessagesSinceLastAssistant, handleInterrupt } from "./services/conversationParsingService";
import { streamRespondToUserWithAI } from "./services/conversationExecutionService";

dotenv.config();

const PORT = process.env['PORT'] ? parseInt(process.env['PORT'] as string) : 8080;
const DOMAIN = process.env['NGROK_URL'] || "localhost";
const WS_URL = `wss://${DOMAIN}/ws`;

function getWelcomeGreeting(): string {
  return readFileSync(join(process.cwd(), 'prompts', 'greeting0.txt'), 'utf8');
}

function getSystemPrompt(): string {
  return readFileSync(join(process.cwd(), 'prompts', 'system0.txt'), 'utf8');
}

// Track active processing for each session
const activeProcessing = new Map<string, { cancelled: boolean }>();

const fastify: FastifyInstance = Fastify();
fastify.register(fastifyWs);
fastify.register(fastifyFormBody);
fastify.all("/twiml", async (request: FastifyRequest, reply: FastifyReply) => {
  reply.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n    <Response>\n      <Connect>\n        <ConversationRelay url="${WS_URL}" welcomeGreeting="${getWelcomeGreeting()}" />\n      </Connect>\n    </Response>`
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
            session.conversation = [{ role: "system", content: getSystemPrompt() }];
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
            streamRespondToUserWithAI(combinedConversation, ws, processingToken);
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

fastify.listen({ port: PORT }).then(() => {
  console.log(
    `Server running at http://localhost:${PORT} and wss://${DOMAIN}/ws`
  );
}).catch((err) => {
  fastify.log.error(err);
  process.exit(1);
}); 