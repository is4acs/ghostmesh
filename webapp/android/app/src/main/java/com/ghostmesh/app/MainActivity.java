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
        configureWebView(getBridge().getWebView());
    }

    private void configureWebView(WebView webView) {
        WebSettings settings = webView.getSettings();

        // WebRTC + Web Crypto API
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);

        // HTTPS uniquement
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // Cache normal
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Auto-accorder les permissions WebRTC (micro) déclarées dans le manifest
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                request.grant(request.getResources());
            }
        });
    }
}
