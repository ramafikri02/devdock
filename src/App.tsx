import { useEffect } from "react";
import { KeyRound, Network } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { CommandPaletteModal } from "@/components/ui/CommandPaletteModal";
import { OverviewView } from "@/views/OverviewView";
import { SettingsView } from "@/views/SettingsView";
import { PlaceholderView } from "@/views/PlaceholderView";
import { useAppStore } from "@/store/appStore";

export default function App() {
  const init = useAppStore((s) => s.init);
  const route = useAppStore((s) => s.route);

  useEffect(() => {
    void init();
  }, [init]);

  const renderMain = () => {
    switch (route.kind) {
      case "overview":
        return <OverviewView />;
      case "ports":
        return (
          <PlaceholderView
            title="Port Inspector"
            description="Daftar semua port aktif dan resolusi bentrok port akan hadir di Wave 4."
            waveLabel="Wave 4"
            icon={Network}
          />
        );
      case "presets":
        return (
          <PlaceholderView
            title="Env Presets"
            description="Preset environment berlapis dengan penyimpanan OS Keychain akan hadir di Wave 2B."
            waveLabel="Wave 2B"
            icon={KeyRound}
          />
        );
      case "settings":
        return <SettingsView />;
      default:
        return <OverviewView />;
    }
  };

  return (
    <>
      <AppShell>{renderMain()}</AppShell>
      <CommandPaletteModal />
    </>
  );
}
