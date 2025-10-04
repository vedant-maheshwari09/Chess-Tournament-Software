import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { useLocation } from "wouter";

export default function SettingsMenu() {
  const [, setLocation] = useLocation();
  return (
    <Button
      variant="outline"
      className="flex items-center gap-2 bg-white dark:bg-gray-800 shadow-lg"
      onClick={() => setLocation("/settings")}
    >
      <Settings className="h-4 w-4" />
      Settings
    </Button>
  );
}
