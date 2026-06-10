import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { appRoutes } from "@/app/routes";
import { isOnboardingCompleted } from "@/shared/api/attentionApi";
import { cx } from "@/shared/lib/cx";
import { OnboardingWizard } from "@/features/onboarding/OnboardingWizard";
import { UpdateBanner } from "@/features/update/UpdateBanner";
import { FlintOrb } from "./FlintOrb";

export function DesktopShell() {
  const [activeRouteId, setActiveRouteId] = useState("home");
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    isOnboardingCompleted()
      .then((completed) => {
        setShowOnboarding(!completed);
        setOnboardingChecked(true);
      })
      .catch(() => setOnboardingChecked(true));
  }, []);

  const activeRoute = useMemo(
    () => appRoutes.find((route) => route.id === activeRouteId) ?? appRoutes[0],
    [activeRouteId],
  );
  const ActiveView = activeRoute.component;

  // Hold a blank screen while we check — prevents a flash of the dashboard.
  if (!onboardingChecked) {
    return <div className="onboarding-blank-screen" />;
  }

  // Render only the wizard until onboarding is complete — no dashboard behind it.
  if (showOnboarding) {
    return <OnboardingWizard onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <main className="desktop-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <FlintOrb size={36} />
        </div>

        <nav className="nav-list">
          {appRoutes.map((route) => {
            const Icon = route.icon;
            const isActive = route.id === activeRouteId;

            return (
              <button
                key={route.id}
                className={cx("nav-item", isActive && "nav-item-active")}
                data-label={route.label}
                type="button"
                aria-label={route.label}
                onClick={() => setActiveRouteId(route.id)}
              >
                <Icon size={18} />
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="content-shell">
        <UpdateBanner />
        <AnimatePresence mode="wait">
          <motion.div
            key={activeRoute.id}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="view-frame"
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <ActiveView />
          </motion.div>
        </AnimatePresence>
      </section>
    </main>
  );
}
