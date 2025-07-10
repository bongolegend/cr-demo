import { db, pool } from '../postgres/kysely';
import { Session, NewSession, SessionUpdate } from '../models/postgres';

/**
 * Get or create a session for a user and call
 * @param userId - The user's ID
 * @param callSid - The Twilio call SID
 * @param websocketId - The WebSocket connection ID
 * @returns The session object
 */
export async function getOrCreateSession(userId: string, callSid: string, websocketId: string): Promise<Session> {
  try {
    // Try to find existing session
    let session = await db
      .selectFrom('sessions')
      .selectAll()
      .where('twilio_call_sid', '=', callSid)
      .executeTakeFirst();

    if (!session) {
      // Create new session
      const newSession: NewSession = {
        user_id: userId,
        twilio_call_sid: callSid,
        twilio_conversation_sid: null,
        twilio_participant_sid: null,
        websocket_id: websocketId,
      };
      
      const result = await db
        .insertInto('sessions')
        .values(newSession)
        .returningAll()
        .executeTakeFirst();
      
      session = result;
    }

    return session as Session;
  } catch (error) {
    console.error('Error getting or creating session:', error);
    throw error;
  }
}

/**
 * Get a session by call SID
 * @param callSid - The Twilio call SID
 * @returns The session object or null if not found
 */
export async function getSessionByCallSid(callSid: string): Promise<Session | null> {
  try {
    const session = await db
      .selectFrom('sessions')
      .selectAll()
      .where('twilio_call_sid', '=', callSid)
      .executeTakeFirst();
    
    return session as Session | null;
  } catch (error) {
    console.error('Error getting session by call SID:', error);
    return null;
  }
}

/**
 * Get a session by ID
 * @param sessionId - The session's ID
 * @returns The session object or null if not found
 */
export async function getSessionById(sessionId: string): Promise<Session | null> {
  try {
    const session = await db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirst();
    
    return session as Session | null;
  } catch (error) {
    console.error('Error getting session by ID:', error);
    return null;
  }
}

/**
 * Get all sessions for a user
 * @param userId - The user's ID
 * @returns Array of session objects
 */
export async function getSessionsByUserId(userId: string): Promise<Session[]> {
  try {
    const sessions = await db
      .selectFrom('sessions')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute();
    
    return sessions as Session[];
  } catch (error) {
    console.error('Error getting sessions by user ID:', error);
    throw error;
  }
}

/**
 * Update session conversation
 * @param sessionId - The session's ID
 * @param conversation - The conversation array
 * @returns The updated session object
 */
export async function updateSessionConversation(sessionId: string, conversation: any[]): Promise<Session> {
  try {
    
    // Update using raw SQL with pool
    await pool.query(
      `UPDATE sessions SET conversation = $1::jsonb WHERE id = $2`,
      [JSON.stringify(conversation), sessionId]
    );
    
    // Get updated session
    const updatedSession = await db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirst();
    
    return updatedSession as Session;
  } catch (error) {
    console.error('Error updating session conversation:', error);
    throw error;
  }
}

/**
 * Update session information
 * @param sessionId - The session's ID
 * @param updates - The fields to update
 * @returns The updated session object
 */
export async function updateSession(sessionId: string, updates: SessionUpdate): Promise<Session> {
  try {
    // Build dynamic update query
    const updateFields = Object.keys(updates).map((key, index) => `${key} = $${index + 2}`).join(', ');
    const values = Object.values(updates);
    
    await pool.query(
      `UPDATE sessions SET ${updateFields} WHERE id = $1`,
      [sessionId, ...values]
    );
    
    // Get updated session
    const result = await pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId]
    );
    
    return result.rows[0] as Session;
  } catch (error) {
    console.error('Error updating session:', error);
    throw error;
  }
}

/**
 * Delete a session by ID
 * @param sessionId - The session's ID
 * @returns True if session was deleted
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    const result = await db
      .deleteFrom('sessions')
      .where('id', '=', sessionId)
      .returning('id')
      .executeTakeFirst();
    
    return !!result;
  } catch (error) {
    console.error('Error deleting session:', error);
    throw error;
  }
}

/**
 * Delete all sessions for a user
 * @param userId - The user's ID
 * @returns Number of sessions deleted
 */
export async function deleteSessionsByUserId(userId: string): Promise<number> {
  try {
    const result = await db
      .deleteFrom('sessions')
      .where('user_id', '=', userId)
      .returning('id')
      .execute();
    
    return result.length;
  } catch (error) {
    console.error('Error deleting sessions by user ID:', error);
    throw error;
  }
} 