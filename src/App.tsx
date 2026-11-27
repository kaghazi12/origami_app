import React from 'react';
import { ToastProvider } from './components/ui/Toast';
import { CreasePatternPage } from './pages/CreasePatternPage';
import { LandingPage } from './pages/LandingPage';
import { LearnPage } from './pages/LearnPage';
import { useRoute } from './router';

/**
 * Three pages:
 * - Home: what this is, and the way into each mode.
 * - Learn: step-by-step designs with captions, one fold at a time (beginners).
 * - Crease pattern: open any .fold crease pattern or folded form, fold it exactly, grab and
 *   inspect it (experienced folders).
 */
export const App: React.FC = () => {
  const route = useRoute();
  return (
    <ToastProvider>
      {route === 'learn' ? <LearnPage /> : route === 'creasePattern' ? <CreasePatternPage /> : <LandingPage />}
    </ToastProvider>
  );
};

export default App;
