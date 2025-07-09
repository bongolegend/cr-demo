import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from "@fastify/formbody";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.NGROK_URL;
const WS_URL = `wss://${DOMAIN}/ws`;
const WELCOME_GREETING =
  "Hi! I am a voice assistant powered by Twilio and Open A I . Ask me anything!";
const SYSTEM_PROMPT =
  "You are a helpful assistant. This conversation is being translated to voice, so answer carefully. When you respond, please spell out all numbers, for example twenty not 20. Do not include emojis in your responses. Do not include bullet points, asterisks, or special symbols.";
const sessions = new Map();

// Message schemas for validation
const messageSchemas = {
  setup: {
    type: 'object',
    required: ['type', 'callSid'],
    properties: {
      type: { type: 'string', enum: ['setup'] },
      callSid: { type: 'string' }
    }
  },
  prompt: {
    type: 'object',
    required: ['type', 'voicePrompt'],
    properties: {
      type: { type: 'string', enum: ['prompt'] },
      voicePrompt: { type: 'string' }
    }
  },
  interrupt: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', enum: ['interrupt'] }
    }
  }
};

// Simple schema validation
function validateMessage(message, schema) {
  if (!message || typeof message !== 'object') {
    throw new Error('Message must be an object');
  }
  
  if (!schema.required.every(field => message.hasOwnProperty(field))) {
    throw new Error(`Missing required fields: ${schema.required.join(', ')}`);
  }
  
  for (const [field, value] of Object.entries(message)) {
    if (schema.properties[field]) {
      const fieldSchema = schema.properties[field];
      if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
        throw new Error(`Invalid value for ${field}: ${value}`);
      }
      if (fieldSchema.type && typeof value !== fieldSchema.type) {
        throw new Error(`Invalid type for ${field}: expected ${fieldSchema.type}, got ${typeof value}`);
      }
    }
  }
}

// Focused error logging
function logWebSocketError(context, error, metadata = {}) {
  console.error(`[WebSocket Error] ${context}:`, {
    error: error.message,
    ...metadata
  });
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
async function aiResponse(messages) {
  try {
    let completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
    });
    return completion.choices[0].message.content;
  } catch (error) {
    logWebSocketError('OpenAI API failed', error, { messageCount: messages.length });
    throw error;
  }
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
    // Handle WebSocket connection errors
    ws.on("error", (error) => {
      logWebSocketError('Connection failed', error, { 
        callSid: ws.callSid,
        readyState: ws.readyState 
      });
    });
    
    // Handle connection close
    ws.on("close", (code, reason) => {
      if (code !== 1000) { // Only log abnormal closures
        logWebSocketError('Connection closed abnormally', new Error(`Code: ${code}, Reason: ${reason}`), {
          callSid: ws.callSid,
          code,
          reason: reason.toString()
        });
      }
      
      if (ws.callSid) {
        sessions.delete(ws.callSid);
      }
    });
    
    // Handle incoming messages
    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data);
        
        // Validate message based on type
        if (!message.type || !messageSchemas[message.type]) {
          throw new Error(`Unknown message type: ${message.type}`);
        }
        
        validateMessage(message, messageSchemas[message.type]);
        
        switch (message.type) {
          case "setup":
            const callSid = message.callSid;
            ws.callSid = callSid;
            sessions.set(callSid, [{ role: "system", content: SYSTEM_PROMPT }]);
            break;
            
          case "prompt":
            if (!ws.callSid) {
              throw new Error('No active call session');
            }
            
            const conversation = sessions.get(ws.callSid);
            if (!conversation) {
              throw new Error(`Session not found for call: ${ws.callSid}`);
            }
            
            conversation.push({ role: "user", content: message.voicePrompt });
            
            const response = await aiResponse(conversation);
            conversation.push({ role: "assistant", content: response });
            
            ws.send(
              JSON.stringify({
                type: "text",
                token: response,
                last: true,
              })
            );
            break;
            
          case "interrupt":
            // Handle interruption if needed
            break;
        }
      } catch (error) {
        logWebSocketError('Message processing failed', error, {
          callSid: ws.callSid,
          data: data.toString().substring(0, 100)
        });
        
        // Try to send error response
        try {
          ws.send(JSON.stringify({
            type: "error",
            message: "Failed to process message"
          }));
        } catch (sendError) {
          logWebSocketError('Failed to send error response', sendError);
        }
      }
    });
  });
});

try {
  fastify.listen({ port: PORT });
  console.log(
    `Server running at http://localhost:${PORT} and wss://${DOMAIN}/ws`
  );
} catch (err) {
  console.error('Server startup failed:', err);
  process.exit(1);
}
