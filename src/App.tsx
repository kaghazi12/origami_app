import React from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { ToastProvider } from './components/ui/Toast';
import { CreasePatternPage } from './pages/CreasePatternPage';
import { CreatePage } from './pages/CreatePage';
import { DesignPage } from './pages/DesignPage';
import { ExplorePage } from './pages/ExplorePage';
import { LandingPage } from './pages/LandingPage';
import { LearnPage } from './pages/LearnPage';
import { ProfilePage } from './pages/ProfilePage';
import { SignInPage } from './pages/SignInPage';
import { useRoute, type RouteInfo } from './router';

/**
 * The pages:
 * - Home: what this is, and the way into each mode.
 * - Learn: step-by-step designs with captions, one fold at a time (beginners).
 * - Crease pattern: open any .fold crease pattern or folded form, fold it exactly, grab and
 *   inspect it (experienced folders).
 * - Explore, a design's page, profiles, sign-in, and Create (the design editor): sharing. The
 *   data lives in this browser for now (src/store).
 */
function page(route: RouteInfo): React.ReactNode {
  switch (route.name) {
    case 'learn': return <LearnPage />;
    case 'creasePattern': return <CreasePatternPage />;
    case 'explore': return <ExplorePage />;
    case 'design': return <DesignPage id={route.id!} />;
    case 'profile': return <ProfilePage handle={route.id!} />;
    case 'create': return <CreatePage id={route.id} />;
    case 'signin': return <SignInPage />;
    default: return <LandingPage />;
  }
}

export const App: React.FC = () => {
  const route = useRoute();
  return (
    // reducedMotion="user": with the OS setting on, motion keeps opacity fades and drops movement
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        {/* popLayout: the old page is lifted out while the new one comes in, so the top bar's
            current-page tab can slide from one to the other */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={`${route.name}/${route.id ?? ''}?${route.search ?? ''}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.2, 0.8, 0.2, 1] } }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            className="w-full"
          >
            {page(route)}
          </motion.div>
        </AnimatePresence>
      </ToastProvider>
    </MotionConfig>
  );
};

export default App;
