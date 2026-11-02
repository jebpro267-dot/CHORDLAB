package app.chordlab.mobile;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_CODE = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.AppTheme_NoActionBar);
        super.onCreate(savedInstanceState);

        // Ensure system status bar and navigation bar never overlap the WebView content
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        getWindow().setStatusBarColor(android.graphics.Color.parseColor("#1b1e26"));
        getWindow().setNavigationBarColor(android.graphics.Color.parseColor("#1b1e26"));

        // Ensure runtime audio permissions are requested on startup
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{
                            Manifest.permission.RECORD_AUDIO,
                            Manifest.permission.MODIFY_AUDIO_SETTINGS
                    },
                    PERMISSION_REQUEST_CODE
            );
        }

        // Configure WebView using BridgeWebChromeClient subclass so file choosing (onShowFileChooser) AND WebRTC both work
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> {
                        request.grant(request.getResources());
                    });
                }
            });
        }
    }
}
