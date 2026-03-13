import { useEffect } from "react";
import { API_BASE } from "../theme";

const IS_NATIVE = typeof location !== "undefined" && location.hostname === "localhost";

export function usePushNotifications(adminToken: string): void {
  useEffect(() => {
    if (!IS_NATIVE || !adminToken) return;

    let removeListeners = () => {};

    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        // Créer le canal de notification AVANT d'enregistrer (Android 8+)
        await PushNotifications.createChannel({
          id: "ghostmesh_alerts",
          name: "GhostMesh Alertes",
          description: "Notifications de nouvelles sessions",
          importance: 5, // IMPORTANCE_HIGH
          sound: "default",
          vibration: true,
          visibility: 1,
        });

        // Ajouter les listeners AVANT register() pour éviter la race condition
        const regListener = await PushNotifications.addListener("registration", async (token) => {
          console.log("[FCM] Token reçu:", token.value.substring(0, 20) + "...");
          try {
            const res = await fetch(`${API_BASE}/admin/register-device`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${adminToken}`,
              },
              body: JSON.stringify({ fcmToken: token.value }),
            });
            console.log("[FCM] Enregistrement serveur:", res.status);
          } catch (e) {
            console.error("[FCM] Erreur enregistrement serveur:", e);
          }
        });

        const errListener = await PushNotifications.addListener("registrationError", (err) => {
          console.error("[FCM] Erreur d'enregistrement:", err.error);
        });

        const fgListener = await PushNotifications.addListener("pushNotificationReceived", (notif) => {
          console.log("[FCM] Notification foreground reçue:", notif.title);
        });

        removeListeners = () => {
          regListener.remove();
          errListener.remove();
          fgListener.remove();
        };

        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== "granted") return;

        await PushNotifications.register();
      } catch {
        // PushNotifications non disponible en contexte web — ignoré
      }
    })();

    return () => removeListeners();
  }, [adminToken]);
}
