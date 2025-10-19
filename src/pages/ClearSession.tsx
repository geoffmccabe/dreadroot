import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ClearSession() {
  const navigate = useNavigate();

  useEffect(() => {
    const clearEverything = async () => {
      console.log('Clearing all session data...');
      
      // Clear all storage
      localStorage.clear();
      sessionStorage.clear();
      
      // Clear IndexedDB
      try {
        const databases = await indexedDB.databases();
        for (const db of databases) {
          if (db.name) {
            indexedDB.deleteDatabase(db.name);
          }
        }
      } catch (e) {
        console.warn('Could not clear IndexedDB:', e);
      }
      
      // Wait a moment then navigate
      setTimeout(() => {
        navigate('/auth', { replace: true });
      }, 500);
    };
    
    clearEverything();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10">
      <div className="text-center">
        <div className="text-xl mb-4">Clearing session...</div>
        <div className="text-sm text-muted-foreground">Please wait</div>
      </div>
    </div>
  );
}
