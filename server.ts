import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from '@fastify/formbody';
import dotenv from "dotenv";
import { getOrCreateUser } from "./services/userService";
import { getOrCreateSession, getSessionByCallSid, updateSessionConversation } from "./services/sessionService";
import { isUserDoneTalking } from "./services/conversationAnalysisService";
import { combineUserMessagesSinceLastAssistant, handleInterrupt } from "./services/conversationParsingService";
import { respondToUser, askUserIfDoneTalking } from "./services/conversationExecutionService";
import { getWelcomeGreeting, getSystemPrompt } from "./services/systemPromptService";
import { getSessionWithUserByCallSid, updateSession } from "./services/sessionService";

dotenv.config();

const PORT = parseInt(process.env['PORT'] as string);
const DOMAIN = process.env['NGROK_URL'];
const WS_URL = `wss://${DOMAIN}/ws`;



// Track active processing for each session
const activeProcessing = new Map<string, { cancelled: boolean }>();

const fastify: FastifyInstance = Fastify();
fastify.register(fastifyWs);
fastify.register(fastifyFormBody);

fastify.all("/twiml", async (request: FastifyRequest, reply: FastifyReply) => {
  // Extract phone number and call SID from query parameters
  const queryParams = request.query as any;
  const phoneNumber = queryParams?.Caller;
  const callSid = queryParams?.CallSid;
  
  // Remove the '+' prefix if present and clean the phone number
  const cleanPhoneNumber = phoneNumber.replace(/^\+/, '');
  
  console.log("TwiML request received for phone number:", cleanPhoneNumber, "; call SID:", callSid);
  
  // Validate required fields
  if (!callSid) {
    console.error("Missing CallSid in TwiML request");
    reply.status(400).send({ error: "Missing CallSid" });
    return;
  }
  
  if (cleanPhoneNumber === "unknown") {
    console.error("Missing phone number in TwiML request");
    reply.status(400).send({ error: "Missing phone number" });
    return;
  }
  
  // Store user in database and create session
  try {
    const user = await getOrCreateUser(cleanPhoneNumber);
    console.log("User stored/retrieved:", user.id, "for phone:", cleanPhoneNumber);
    
    // Create session without websocket ID (will be set when websocket connects)
    // Store all Twilio query parameters in the twilio_query field
    const session = await getOrCreateSession(user.id, callSid, null, queryParams);
    console.log("Session created for call:", session.id);
  } catch (error) {
    console.error("Error storing user or creating session:", error);
    // Continue with the response even if there's an error
  }
  
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
          
          if (!ws.id) {
            ws.id = Math.random().toString(36).slice(2); // fallback id
          }
          
          // Get existing session with user info
          const sessionWithUser = await getSessionWithUserByCallSid(callSid);
          
          if (sessionWithUser) {
            console.log("Found existing session for call:", sessionWithUser.id, "user:", sessionWithUser.user.phone_number);
            
            // Update the websocket ID in the session
            await updateSession(sessionWithUser.id, { websocket_id: ws.id });
            
            if (!sessionWithUser.conversation || sessionWithUser.conversation.length === 0) {
              sessionWithUser.conversation = [{ role: "system", content: getSystemPrompt() }];
              await updateSessionConversation(sessionWithUser.id, sessionWithUser.conversation);
            }
          } else {
            console.error("No session found for call SID:", callSid);
            // Send error message to client
            ws.send(JSON.stringify({
              type: "error",
              message: "No session found for this call. Please try calling again."
            }));
            return;
          }
          break;
        }
        case "prompt": {
          console.log("Received user input:", message.voicePrompt);
          if (!ws.callSid) {
            console.error("ws.callSid is undefined");
            break;
          }
          const existingProcessing = activeProcessing.get(ws.callSid);
          if (existingProcessing) {
            console.log("Cancelling previous processing...");
            existingProcessing.cancelled = true;
          }
          const processingToken = { cancelled: false };
          activeProcessing.set(ws.callSid, processingToken);
          
          const sessionData = await getSessionByCallSid(ws.callSid);
          if (sessionData && sessionData.conversation) {
            sessionData.conversation = [...sessionData.conversation, {
              role: "user",
              content: message.voicePrompt,
            }];
            const combinedConversation = await combineUserMessagesSinceLastAssistant(sessionData);
            const userDone = await isUserDoneTalking(combinedConversation);
            if (!userDone) {
              console.log("Waiting 3 seconds...");
              for (let i = 3; i > 0; i--) {
                if (processingToken.cancelled) {
                  console.log("Processing cancelled, stopping countdown");
                  return;
                }
                console.log(`${i} seconds...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
            respondToUser(sessionData, ws, processingToken);
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