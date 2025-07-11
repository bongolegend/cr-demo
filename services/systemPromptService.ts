import { readFileSync } from "fs";
import { join } from "path";

/**
 * Get the current date and time in Central Time
 * @returns Object with formatted date/time information
 */
function getCurrentDateTime(): { 
  time: string; 
  date: string; 
  dayOfWeek: string; 
  fullDateTime: string; 
} {
  const now = new Date();
  
  // Convert to Central Time
  const centralTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  
  const time = centralTime.toLocaleTimeString("en-US", { 
    hour: "numeric", 
    minute: "2-digit",
    hour12: true 
  });
  
  const date = centralTime.toLocaleDateString("en-US", { 
    month: "long", 
    day: "numeric", 
    year: "numeric" 
  });
  
  const dayOfWeek = centralTime.toLocaleDateString("en-US", { weekday: "long" });
  
  const fullDateTime = `${dayOfWeek}, ${date} at ${time}`;
  
  return { time, date, dayOfWeek, fullDateTime };
}

/**
 * Get the welcome greeting from file
 * @returns The welcome greeting text
 */
export function getWelcomeGreeting(): string {
  return readFileSync(join(process.cwd(), 'prompts', 'greeting0.txt'), 'utf8');
}

/**
 * Get the system prompt from file with dynamic date/time information
 * @returns The system prompt text with current date/time
 */
export function getSystemPrompt(): string {
  const basePrompt = readFileSync(join(process.cwd(), 'prompts', 'goal-tracker', 'system0.txt'), 'utf8');
  const { fullDateTime } = getCurrentDateTime();
  
  const dynamicPrompt = `Today is ${fullDateTime}. ${basePrompt}`;
  
  return dynamicPrompt;
} 