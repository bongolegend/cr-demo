import { db } from '../postgres/kysely';
import { User, NewUser, UserUpdate } from '../models/postgres';

/**
 * Get or create a user by phone number
 * @param phoneNumber - The user's phone number
 * @returns The user object
 */
export async function getOrCreateUser(phoneNumber: string): Promise<User> {
  try {
    // Try to find existing user
    let user = await db
      .selectFrom('users')
      .selectAll()
      .where('phone_number', '=', phoneNumber)
      .executeTakeFirst();

    if (!user) {
      // Create new user
      const newUser: NewUser = {
        phone_number: phoneNumber,
        full_name: null,
        email: null
      };
      
      const result = await db
        .insertInto('users')
        .values(newUser)
        .returningAll()
        .executeTakeFirst();
      
      user = result;
    }

    return user as User;
  } catch (error) {
    console.error('Error getting or creating user:', error);
    throw error;
  }
}

/**
 * Get a user by phone number
 * @param phoneNumber - The user's phone number
 * @returns The user object or null if not found
 */
export async function getUserByPhoneNumber(phoneNumber: string): Promise<User | null> {
  try {
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('phone_number', '=', phoneNumber)
      .executeTakeFirst();
    
    return user as User | null;
  } catch (error) {
    console.error('Error getting user by phone number:', error);
    throw error;
  }
}

/**
 * Get a user by ID
 * @param userId - The user's ID
 * @returns The user object or null if not found
 */
export async function getUserById(userId: string): Promise<User | null> {
  try {
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirst();
    
    return user as User | null;
  } catch (error) {
    console.error('Error getting user by ID:', error);
    throw error;
  }
}

/**
 * Update user information
 * @param userId - The user's ID
 * @param updates - The fields to update
 * @returns The updated user object
 */
export async function updateUser(userId: string, updates: UserUpdate): Promise<User> {
  try {
    const result = await db
      .updateTable('users')
      .set(updates)
      .where('id', '=', userId)
      .returningAll()
      .executeTakeFirst();
    
    return result as User;
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
}

/**
 * Delete a user by ID
 * @param userId - The user's ID
 * @returns True if user was deleted
 */
export async function deleteUser(userId: string): Promise<boolean> {
  try {
    const result = await db
      .deleteFrom('users')
      .where('id', '=', userId)
      .returning('id')
      .executeTakeFirst();
    
    return !!result;
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
} 