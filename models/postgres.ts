import { Generated, Insertable, Selectable, Updateable } from 'kysely';

// Users table interface
export interface UsersTable {
  id: Generated<string>; // UUID
  phone_number: string;
  full_name: string | null;
  email: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// Sessions table interface
export interface SessionsTable {
  id: Generated<string>; // UUID
  user_id: string; // UUID - references users.id
  twilio_call_sid: string | null;
  twilio_conversation_sid: string | null;
  twilio_participant_sid: string | null;
  websocket_id: string | null;
  twilio_query: any | null; // JSONB - Twilio query parameters
  conversation: any[] | null; // JSONB array - manually set, not auto-generated
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// Database interface that combines all tables
export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
}

// Type exports for easier usage
export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

export type Session = Selectable<SessionsTable>;
export type NewSession = Insertable<SessionsTable>;
export type SessionUpdate = Updateable<SessionsTable>; 