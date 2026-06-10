import type { ComponentType } from "react";
import { Home, Settings } from "lucide-react";
import { MdInsights } from "react-icons/md";
import { TbReportSearch } from "react-icons/tb";
import { GiHorizonRoad } from "react-icons/gi";
import type { ReactElement } from "react";
import { DriftMapView } from "@/features/drift-map/DriftMapView";
import { ReportsView } from "@/features/reports/ReportsView";
import { HomeView } from "@/features/home/HomeView";
import { InsightsView } from "@/features/insights/InsightsView";
import { SettingsView } from "@/features/settings/SettingsView";

export type AppRoute = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  component: () => ReactElement;
};

export const appRoutes: AppRoute[] = [
  { id: "home", label: "Home", icon: Home, component: HomeView },
  { id: "drift", label: "Cognitive Trail", icon: GiHorizonRoad, component: DriftMapView },
  { id: "reports", label: "Reports", icon: TbReportSearch, component: ReportsView },
  { id: "insights", label: "Insights", icon: MdInsights, component: InsightsView },
  { id: "settings", label: "Privacy controls", icon: Settings, component: SettingsView },
];
