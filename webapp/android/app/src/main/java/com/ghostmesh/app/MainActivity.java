package com.ghostmesh.app;

import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Récupère la WebView de Capacitor et configure-la pour WebRTC
        // et Web Crypto API (requis par GhostMesh E2E)
        WebView webView = getBridge().getWebView();
        configureWebView(webView);
    }

    private void configureWebView(WebView webView) {
        WebSettings settings = webView.getSettings();

        // Indispensable pour WebRTC (getUserMedia, RTCPeerConnection)
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);

        // Sécurité : HTTPS uniquement
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // Performance
        settings.setHardwareAccelerated(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Autorise WebRTC à accéder au micro sans pop-up système répété
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Accorde automatiquement les permissions WebRTC déclarées
                // dans le manifest (RECORD_AUDIO).
                // L'utilisateur a déjà accordé la permission au niveau OS.
                request.grant(request.getResources());
            }
        });
    }
}
