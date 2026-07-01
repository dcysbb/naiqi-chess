package com.chessgame.darkchess;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MobileHostPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
