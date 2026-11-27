import React from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
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
    // reducedMotion="user": with the OS setting on, motion keeps opacity fades and drops movement
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        {/* popLayout: the old page is lifted out while the new one comes in, so the top bar's
            current-mode tab can slide from one to the other */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={route}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.2, 0.8, 0.2, 1] } }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            className="w-full"
          >
            {route === 'learn' ? <LearnPage /> : route === 'creasePattern' ? <CreasePatternPage /> : <LandingPage />}
          </motion.div>
        </AnimatePresence>
      </ToastProvider>
    </MotionConfig>
  );
};

export default App;
