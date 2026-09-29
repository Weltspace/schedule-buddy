package com.weltspace.schedulebuddy;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 纯离线壳：整个前端打包在 assets/www/，通过 WebViewAssetLoader 以
 * https://appassets.androidplatform.net/assets/ 的正规 origin 加载
 * （IndexedDB / localStorage 在 file:// 下不可靠，必须用这种方式）。
 *
 * 数据（IndexedDB：日程、长期任务、设置、背景图、AI Key）全部存在
 * APP 私有空间 /data/data/com.weltspace.schedulebuddy/，只有卸载才会清掉。
 *
 * 与网页的桥（window.AndroidBridge）：
 * - shareSync(fileName, json)：导出同步包 → 系统分享面板（微信/QQ/保存文件）
 * - 微信里"用其他应用打开→日程助手"：ACTION_SEND/VIEW 收到 json，
 *   base64 注入 window.__sbReceiveSharedFile，走网页端原有的防呆导入流程。
 */
public class MainActivity extends Activity {

    private WebView web;
    private WebViewAssetLoader assetLoader;
    private byte[] pendingShared = null;   // 从微信等收到的待导入同步包
    private boolean pageReady = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                // 外部链接（如仓库主页）交给系统浏览器
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                injectSharedFile();   // 若是带着微信收到的文件冷启动进来的
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");

        handleSendIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleSendIntent(intent);
    }

    /** 微信"用其他应用打开"（ACTION_SEND 带 EXTRA_STREAM）或文件管理器"打开方式"（ACTION_VIEW content://） */
    private void handleSendIntent(Intent intent) {
        if (intent == null) return;
        Uri stream = null;
        if (Intent.ACTION_SEND.equals(intent.getAction()) && intent.hasExtra(Intent.EXTRA_STREAM)) {
            stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        } else if (Intent.ACTION_VIEW.equals(intent.getAction())
                && "content".equals(intent.getScheme())) {
            stream = intent.getData();
        }
        if (stream == null) return;
        try (InputStream in = getContentResolver().openInputStream(stream)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            pendingShared = buf.toByteArray();
            injectSharedFile();   // 页面已就绪就直接注入，否则等 onPageFinished
        } catch (Exception e) {
            Toast.makeText(this, "读取文件失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void injectSharedFile() {
        if (pendingShared == null || !pageReady || web == null) return;
        byte[] data = pendingShared;
        pendingShared = null;
        final String b64 = Base64.encodeToString(data, Base64.NO_WRAP);
        runOnUiThread(() -> web.evaluateJavascript(
                "window.__sbReceiveSharedFile && window.__sbReceiveSharedFile('" + b64 + "');", null));
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private class Bridge {
        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        /** 导出同步包：写入 cache 后经 FileProvider 调系统分享面板 */
        @JavascriptInterface
        public void shareSync(String fileName, String json) {
            try {
                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, fileName);
                try (OutputStream os = new FileOutputStream(f)) {
                    os.write(json.getBytes(StandardCharsets.UTF_8));
                }
                Uri uri = FileProvider.getUriForFile(MainActivity.this,
                        getPackageName() + ".fileprovider", f);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("application/json");
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(send, "分享同步包")));
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "分享失败：" + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }
    }
}
