package com.chessgame.darkchess;

import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "MobileHost")
public class MobileHostPlugin extends Plugin {
    private static final int DEFAULT_PORT = 3030;
    private static final String SERVICE = "chess";

    private final Map<String, GuestConnection> guests = new ConcurrentHashMap<>();
    private final Map<String, PendingRequest> pending = new ConcurrentHashMap<>();

    private volatile SimpleHttpServer server;
    private volatile int port = DEFAULT_PORT;
    private volatile String hostName = "奶棋手机";
    private volatile String hostId = "mobile-host";
    private volatile int openRooms = 0;

    @PluginMethod
    public void start(PluginCall call) {
        hostName = call.getString("hostName", hostName);
        hostId = makeHostId();
        int requestedPort = call.getInt("port", DEFAULT_PORT);

        if (server != null && server.isRunning()) {
            call.resolve(currentInfo());
            return;
        }

        IOException lastError = null;
        for (int candidate = requestedPort; candidate <= requestedPort + 10; candidate++) {
            try {
                ServerSocket socket = new ServerSocket();
                socket.setReuseAddress(true);
                socket.bind(new InetSocketAddress("0.0.0.0", candidate));
                SimpleHttpServer httpServer = new SimpleHttpServer(socket);
                httpServer.start();
                server = httpServer;
                port = candidate;
                call.resolve(currentInfo());
                return;
            } catch (IOException error) {
                lastError = error;
            }
        }

        call.reject(lastError != null ? lastError.getMessage() : "Unable to start mobile host");
    }

    @PluginMethod
    public void stop(PluginCall call) {
        SimpleHttpServer current = server;
        server = null;
        if (current != null) current.stop();
        guests.clear();
        pending.clear();
        call.resolve(ok());
    }

    @PluginMethod
    public void updateInfo(PluginCall call) {
        Integer nextOpenRooms = call.getInt("openRooms");
        if (nextOpenRooms != null) openRooms = nextOpenRooms;
        String nextHostName = call.getString("hostName");
        if (nextHostName != null && !nextHostName.isEmpty()) hostName = nextHostName;
        call.resolve(ok());
    }

    @PluginMethod
    public void respond(PluginCall call) {
        String requestId = call.getString("requestId");
        if (requestId == null) {
            call.reject("requestId is required");
            return;
        }

        PendingRequest request = pending.remove(requestId);
        if (request == null) {
            call.resolve(ok());
            return;
        }

        Object response = call.getData().opt("response");
        request.respond(response == null ? JSONObject.NULL : response);
        call.resolve(ok());
    }

    @PluginMethod
    public void emitToGuest(PluginCall call) {
        String connId = call.getString("connId");
        String event = call.getString("event");
        if (connId == null || event == null) {
            call.reject("connId and event are required");
            return;
        }

        GuestConnection guest = guests.get(connId);
        if (guest != null) {
            Object payload = call.getData().opt("payload");
            guest.enqueue(new OutgoingEvent(event, payload == null ? JSONObject.NULL : payload));
        }
        call.resolve(ok());
    }

    @PluginMethod
    public void getNetworkInfo(PluginCall call) {
        call.resolve(networkInfo());
    }

    private JSObject ok() {
        JSObject obj = new JSObject();
        obj.put("ok", true);
        return obj;
    }

    private JSObject currentInfo() {
        JSObject info = networkInfo();
        info.put("ok", true);
        info.put("hostName", hostName);
        info.put("hostId", hostId);
        info.put("port", port);
        info.put("openRooms", openRooms);
        info.put("service", SERVICE);
        info.put("mobileHost", true);
        JSONArray urls = info.optJSONArray("urls");
        info.put("url", urls != null && urls.length() > 0 ? urls.optString(0) : "http://localhost:" + port);
        return info;
    }

    private JSObject networkInfo() {
        JSObject info = new JSObject();
        JSONArray addresses = new JSONArray();
        JSONArray urls = new JSONArray();

        for (String address : getLanAddresses()) {
            addresses.put(address);
            urls.put("http://" + address + ":" + port);
        }
        if (urls.length() == 0) {
            urls.put("http://localhost:" + port);
        }

        info.put("addresses", addresses);
        info.put("urls", urls);
        info.put("port", port);
        return info;
    }

    private List<String> getLanAddresses() {
        List<String> out = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface nif = interfaces.nextElement();
                if (!nif.isUp() || nif.isLoopback()) continue;
                Enumeration<InetAddress> addresses = nif.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        out.add(address.getHostAddress());
                    }
                }
            }
        } catch (Exception ignored) {
            // Best effort only; manual IP entry still works.
        }
        return out;
    }

    private String makeHostId() {
        try {
            String androidId = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID);
            if (androidId != null && !androidId.isEmpty()) {
                return "phone-" + androidId.substring(0, Math.min(androidId.length(), 8));
            }
        } catch (Exception ignored) {
            // Fall through to a process-local id.
        }
        return "phone-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private void notifyOnMain(String eventName, JSObject payload) {
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> notifyListeners(eventName, payload));
        } else {
            notifyListeners(eventName, payload);
        }
    }

    private JSONObject chessInfoJson() throws Exception {
        JSONObject info = new JSONObject();
        info.put("hostName", hostName);
        info.put("hostId", hostId);
        info.put("openRooms", openRooms);
        info.put("service", SERVICE);
        info.put("mobileHost", true);
        return info;
    }

    private JSONObject connectGuest() throws Exception {
        String connId = "guest-" + UUID.randomUUID();
        guests.put(connId, new GuestConnection(connId));

        JSObject payload = new JSObject();
        payload.put("connId", connId);
        notifyOnMain("guestConnected", payload);

        JSONObject res = new JSONObject();
        res.put("ok", true);
        res.put("connId", connId);
        res.put("hostName", hostName);
        res.put("hostId", hostId);
        return res;
    }

    private JSONObject handleGuestEmit(JSONObject body) throws Exception {
        String connId = body.optString("connId", "");
        String event = body.optString("event", "");
        GuestConnection guest = guests.get(connId);
        if (guest == null || event.isEmpty()) {
            return errorJson("Guest is not connected");
        }

        String requestId = UUID.randomUUID().toString();
        PendingRequest request = new PendingRequest();
        pending.put(requestId, request);

        JSObject payload = new JSObject();
        payload.put("connId", connId);
        payload.put("requestId", requestId);
        payload.put("event", event);
        payload.put("payload", body.opt("payload"));
        notifyOnMain("guestEmit", payload);

        Object response = request.await(10000);
        pending.remove(requestId);
        if (response == null) return errorJson("Host response timeout");

        JSONObject res = new JSONObject();
        res.put("ok", true);
        res.put("response", response);
        return res;
    }

    private JSONObject pollGuest(JSONObject body) throws Exception {
        String connId = body.optString("connId", "");
        GuestConnection guest = guests.get(connId);
        if (guest == null) return errorJson("Guest is not connected");

        JSONArray events = new JSONArray();
        List<OutgoingEvent> batch = guest.poll(20000);
        for (OutgoingEvent event : batch) {
            JSONObject item = new JSONObject();
            item.put("event", event.event);
            item.put("payload", event.payload);
            events.put(item);
        }

        JSONObject res = new JSONObject();
        res.put("ok", true);
        res.put("events", events);
        return res;
    }

    private JSONObject disconnectGuest(JSONObject body) throws Exception {
        String connId = body.optString("connId", "");
        if (!connId.isEmpty()) {
            guests.remove(connId);
            JSObject payload = new JSObject();
            payload.put("connId", connId);
            notifyOnMain("guestDisconnected", payload);
        }
        JSONObject res = new JSONObject();
        res.put("ok", true);
        return res;
    }

    private JSONObject errorJson(String message) throws Exception {
        JSONObject res = new JSONObject();
        res.put("ok", false);
        res.put("error", message);
        return res;
    }

    private class SimpleHttpServer implements Runnable {
        private final ServerSocket socket;
        private final ExecutorService workers = Executors.newCachedThreadPool();
        private volatile boolean running = true;
        private Thread thread;

        SimpleHttpServer(ServerSocket socket) {
            this.socket = socket;
        }

        boolean isRunning() {
            return running && !socket.isClosed();
        }

        void start() {
            thread = new Thread(this, "ChessMobileHost");
            thread.start();
        }

        void stop() {
            running = false;
            try {
                socket.close();
            } catch (IOException ignored) {
                // Already closed.
            }
            workers.shutdownNow();
        }

        @Override
        public void run() {
            while (running) {
                try {
                    Socket client = socket.accept();
                    workers.execute(() -> handle(client));
                } catch (IOException error) {
                    if (running) error.printStackTrace();
                }
            }
        }

        private void handle(Socket client) {
            try (Socket closeable = client) {
                HttpRequest req = readRequest(closeable.getInputStream());
                if (req == null) return;

                if ("OPTIONS".equals(req.method)) {
                    send(closeable.getOutputStream(), 204, "");
                    return;
                }

                JSONObject response;
                switch (req.path) {
                    case "/__chess_info__":
                        response = chessInfoJson();
                        break;
                    case "/__mobile_host__/guest/connect":
                        response = connectGuest();
                        break;
                    case "/__mobile_host__/guest/emit":
                        response = handleGuestEmit(req.jsonBody());
                        break;
                    case "/__mobile_host__/guest/poll":
                        response = pollGuest(req.jsonBody());
                        break;
                    case "/__mobile_host__/guest/disconnect":
                        response = disconnectGuest(req.jsonBody());
                        break;
                    default:
                        send(closeable.getOutputStream(), 404, "{\"ok\":false,\"error\":\"Not found\"}");
                        return;
                }
                send(closeable.getOutputStream(), 200, response.toString());
            } catch (Exception error) {
                try {
                    send(client.getOutputStream(), 500, "{\"ok\":false,\"error\":\"" + escape(error.getMessage()) + "\"}");
                } catch (IOException ignored) {
                    // Client is already gone.
                }
            }
        }

        private HttpRequest readRequest(InputStream in) throws Exception {
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return null;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return null;

            int contentLength = 0;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon <= 0) continue;
                String name = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
                String value = line.substring(colon + 1).trim();
                if ("content-length".equals(name)) {
                    contentLength = Integer.parseInt(value);
                }
            }

            byte[] body = new byte[Math.max(contentLength, 0)];
            int read = 0;
            while (read < body.length) {
                int n = in.read(body, read, body.length - read);
                if (n < 0) break;
                read += n;
            }

            String path = parts[1];
            int query = path.indexOf('?');
            if (query >= 0) path = path.substring(0, query);
            return new HttpRequest(parts[0].toUpperCase(Locale.ROOT), path, new String(body, 0, read, StandardCharsets.UTF_8));
        }

        private String readLine(InputStream in) throws IOException {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            int prev = -1;
            int cur;
            while ((cur = in.read()) != -1) {
                if (prev == '\r' && cur == '\n') {
                    byte[] bytes = buffer.toByteArray();
                    int len = bytes.length;
                    if (len > 0 && bytes[len - 1] == '\r') len--;
                    return new String(bytes, 0, len, StandardCharsets.UTF_8);
                }
                buffer.write(cur);
                prev = cur;
            }
            if (buffer.size() == 0) return null;
            return buffer.toString(StandardCharsets.UTF_8.name());
        }

        private void send(OutputStream out, int status, String body) throws IOException {
            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            String statusText = status == 200 ? "OK" : status == 204 ? "No Content" : status == 404 ? "Not Found" : "Error";
            String headers = "HTTP/1.1 " + status + " " + statusText + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + payload.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                + "Access-Control-Allow-Headers: Content-Type\r\n"
                + "Connection: close\r\n\r\n";
            out.write(headers.getBytes(StandardCharsets.UTF_8));
            out.write(payload);
            out.flush();
        }
    }

    private static class HttpRequest {
        final String method;
        final String path;
        final String body;

        HttpRequest(String method, String path, String body) {
            this.method = method;
            this.path = path;
            this.body = body == null ? "" : body;
        }

        JSONObject jsonBody() throws Exception {
            if (body.isEmpty()) return new JSONObject();
            return new JSONObject(body);
        }
    }

    private static class GuestConnection {
        final String connId;
        final BlockingQueue<OutgoingEvent> queue = new LinkedBlockingQueue<>();

        GuestConnection(String connId) {
            this.connId = connId;
        }

        void enqueue(OutgoingEvent event) {
            queue.offer(event);
        }

        List<OutgoingEvent> poll(long timeoutMs) throws InterruptedException {
            List<OutgoingEvent> out = new ArrayList<>();
            OutgoingEvent first = queue.poll(timeoutMs, TimeUnit.MILLISECONDS);
            if (first != null) {
                out.add(first);
                queue.drainTo(out);
            }
            return out;
        }
    }

    private static class OutgoingEvent {
        final String event;
        final Object payload;

        OutgoingEvent(String event, Object payload) {
            this.event = event;
            this.payload = payload;
        }
    }

    private static class PendingRequest {
        private final CountDownLatch latch = new CountDownLatch(1);
        private volatile Object response;

        void respond(Object response) {
            this.response = response;
            latch.countDown();
        }

        Object await(long timeoutMs) throws InterruptedException {
            if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) return null;
            return response;
        }
    }

    private static String escape(String text) {
        if (text == null) return "";
        return text.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
