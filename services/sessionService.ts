import { db, pool } from '../postgres/kysely';
import { Session, NewSession, SessionUpdate } from '../models/postgres';

/**
 * Get or create a session for a user and call
 * @param userId - The user's ID
 * @param callSid - The Twilio call SID
 * @param websocketId - The WebSocket connection ID (can be null)
 * @param twilioQuery - The Twilio query parameters (optional)
 * @returns The session object
 */
export async function getOrCreateSession(userId: string, callSid: string, websocketId: string | null, twilioQuery?: any): Promise<Session> {
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
        websocket_id: websocketId,
        twilio_query: twilioQuery || null,
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
 * Get a session with user information by call SID
 * @param callSid - The Twilio call SID
 * @returns The session object with user info or null if not found
 */
export async function getSessionWithUserByCallSid(callSid: string): Promise<(Session & { user: any }) | null> {
  try {
    const session = await db
      .selectFrom('sessions')
      .innerJoin('users', 'sessions.user_id', 'users.id')
      .selectAll('sessions')
      .select(['users.id as user_id', 'users.phone_number', 'users.full_name', 'users.email'])
      .where('sessions.twilio_call_sid', '=', callSid)
      .executeTakeFirst();
    
    if (!session) return null;
    
    return {
      ...session,
      user: {
        id: session.user_id,
        phone_number: session.phone_number,
        full_name: session.full_name,
        email: session.email
      }
    } as (Session & { user: any });
  } catch (error) {
    console.error('Error getting session with user by call SID:', error);
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

/**
 * Get Twilio query parameters from a session
 * @param sessionId - The session's ID
 * @returns The Twilio query parameters or null
 */
export async function getTwilioQueryParams(sessionId: string): Promise<any | null> {
  try {
    const session = await db
      .selectFrom('sessions')
      .select('twilio_query')
      .where('id', '=', sessionId)
      .executeTakeFirst();
    
    return session?.twilio_query || null;
  } catch (error) {
    console.error('Error getting Twilio query params:', error);
    return null;
  }
}

/**
 * Update Twilio query parameters for a session
 * @param sessionId - The session's ID
 * @param twilioQuery - The Twilio query parameters
 * @returns The updated session object
 */
export async function updateTwilioQueryParams(sessionId: string, twilioQuery: any): Promise<Session> {
  try {
    const result = await db
      .updateTable('sessions')
      .set({ twilio_query: twilioQuery })
      .where('id', '=', sessionId)
      .returningAll()
      .executeTakeFirst();
    
    return result as Session;
  } catch (error) {
    console.error('Error updating Twilio query params:', error);
    throw error;
  }
} 