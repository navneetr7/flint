import { AppProviders } from "./AppProviders";
import { DesktopShell } from "./shell/DesktopShell";

export function App() {
  return (
    <AppProviders>
      <DesktopShell />
    </AppProviders>
  );
}
