import { useEffect } from "react";
import { API_BASE } from "../theme";

const IS_NATIVE = typeof location !== "undefined" && location.hostname === "localhost";

/**
 * Enregistre le token FCM auprès du serveur Railway dès que l'APK démarre.
 * Ne fait rien en contexte web (IS_NATIVE = false).
 */
export function usePushNotifications(adminToken: string): void {
  useEffect(() => {
    if (!IS_NATIVE || !adminToken) return;

    let removeListeners = () => {};

    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== "granted") return;

        await PushNotifications.register();

        const regListener = await PushNotifications.addListener("registration", async (token) => {
          try {
            await fetch(`${API_BASE}/admin/register-device`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${adminToken}`,
              },
              body: JSON.stringify({ fcmToken: token.value }),
            });
          } catch { /* best-effort */ }
        });

        const errListener = await PushNotifications.addListener("registrationError", (err) => {
          console.error("[FCM] Erreur d'enregistrement:", err.error);
        });

        removeListeners = () => {
          regListener.remove();
          errListener.remove();
        };
      } catch {
        // PushNotifications non disponible en contexte web — ignoré
      }
    })();

    return () => removeListeners();
  }, [adminToken]);
}
