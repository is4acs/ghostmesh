import { useState } from "react";
import { AdminLoginMobile, AdminDashboardMobile, AdminChatMobile } from "./ui/AdminMobile";

type Screen =
  | { type: "admin_login" }
  | { type: "admin_dashboard"; token: string }
  | { type: "admin_chat"; roomId: string; token: string; clientCode: string; clientLabel?: string; secure: boolean };

// APK admin-only : toujours l'interface administrateur
export default function App() {
  const [screen, setScreen] = useState<Screen>({ type: "admin_login" });
  return <NativeAdminApp screen={screen} setScreen={setScreen} />;
}

function NativeAdminApp({ screen, setScreen }: { screen: Screen; setScreen: (s: Screen) => void }) {
  const [token, setToken] = useState<string>(() => sessionStorage.getItem("ghost_admin_token") || "");

  const handleLogin = (t: string) => {
    sessionStorage.setItem("ghost_admin_token", t);
    setToken(t);
    setScreen({ type: "admin_dashboard", token: t });
  };

  if (!token || screen.type === "admin_login") {
    return <AdminLoginMobile onLogin={handleLogin} />;
  }
  if (screen.type === "admin_dashboard") {
    return (
      <AdminDashboardMobile
        token={token}
        onJoinSession={(session) =>
          setScreen({
            type: "admin_chat",
            roomId: session.roomId,
            token: token,
            clientCode: session.clientCode,
            clientLabel: session.clientLabel,
            secure: session.secure,
          })
        }
      />
    );
  }
  if (screen.type === "admin_chat") {
    return (
      <AdminChatMobile
        roomId={screen.roomId}
        token={token}
        clientCode={screen.clientCode}
        clientLabel={screen.clientLabel}
        secure={screen.secure}
        onBack={() => setScreen({ type: "admin_dashboard", token })}
      />
    );
  }

  return <AdminLoginMobile onLogin={handleLogin} />;
}

