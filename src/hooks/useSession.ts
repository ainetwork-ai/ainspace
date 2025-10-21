import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';

export function useSession() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    // Check if user already has a session in localStorage
    let storedUserId = localStorage.getItem('tile-game-user-id');
    
    if (!storedUserId) {
      // Generate new user ID if none exists
      storedUserId = uuidv4();
      localStorage.setItem('tile-game-user-id', storedUserId);
    }
    
    setUserId(storedUserId);
  }, []);

  return { userId };
}