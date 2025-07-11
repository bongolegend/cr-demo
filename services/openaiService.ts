import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();    

// Initialize OpenAI client
export const openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] }); 