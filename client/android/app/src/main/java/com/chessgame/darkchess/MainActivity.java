package com.chessgame.darkchess;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MobileHostPlugin.class);
        super.onCreate(savedInstanceState);
        applyAppChrome();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBackPressedFromJs();
            }
        });
    }

    private void handleBackPressedFromJs() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            finish();
            return;
        }

        getBridge().getWebView().evaluateJavascript(
            "(window.__chessHandleNativeBack && window.__chessHandleNativeBack()) === true",
            handled -> {
                if (!"true".equals(handled)) finish();
            }
        );
    }

    @SuppressWarnings("deprecation")
    private void applyAppChrome() {
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(7, 24, 47));
        window.setNavigationBarColor(Color.rgb(7, 24, 47));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && window.getInsetsController() != null) {
            window.getInsetsController().setSystemBarsAppearance(
                0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            );
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = window.getDecorView().getSystemUiVisibility();
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }
}
