package org.xnlc.legacy;

import java.applet.Applet;
import java.applet.AppletContext;
import java.applet.AppletStub;
import java.applet.AudioClip;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.EventQueue;
import java.awt.Frame;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.File;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/** Самостоятельная обёртка для клиентов с Applet API; совместима с Java 8. */
public final class XnlcLegacyLauncher implements AppletStub, AppletContext {
    private final Map<String, String> parameters = new HashMap<String, String>();
    private final Map<String, InputStream> streams = new HashMap<String, InputStream>();
    private Applet applet;
    private Frame frame;
    private boolean active;

    public static void main(final String[] args) throws Exception {
        if (args.length < 6) throw new IllegalArgumentException("Expected mainClass, user, session, width, height, appletClass");
        final File directory = new File(System.getProperty("user.dir")).getCanonicalFile();
        System.setProperty("minecraft.applet.TargetDirectory", directory.getPath());
        final Class<?> minecraft = Class.forName(args[0], false, ClassLoader.getSystemClassLoader());
        // Старые клиенты кэшируют путь в приватном статическом поле File.
        for (Field field : minecraft.getDeclaredFields()) {
            int modifiers = field.getModifiers();
            if (field.getType() == File.class && Modifier.isStatic(modifiers)
                    && Modifier.isPrivate(modifiers) && !Modifier.isFinal(modifiers)) {
                field.setAccessible(true);
                field.set(null, directory);
                break;
            }
        }
        if ("-".equals(args[5])) {
            invokeMain(minecraft, args);
            return;
        }
        final Applet child;
        try {
            child = (Applet) Class.forName(args[5]).getDeclaredConstructor().newInstance();
        } catch (ClassNotFoundException missingApplet) {
            invokeMain(minecraft, args);
            return;
        }
        final Applet instance = new net.minecraft.Launcher(child);
        final XnlcLegacyLauncher launcher = new XnlcLegacyLauncher();
        launcher.applet = instance;
        launcher.parameters.put("username", args[1]);
        launcher.parameters.put("sessionid", args[2]);
        launcher.parameters.put("stand-alone", "true");
        launcher.parameters.put("haspaid", "true");
        launcher.parameters.put("fullscreen", "false");
        for (int index = 6; index < args.length; index++) {
            if ("--demo".equals(args[index])) launcher.parameters.put("demo", "true");
            if ("--server".equals(args[index]) && index + 1 < args.length) launcher.parameters.put("server", args[++index]);
            if ("--port".equals(args[index]) && index + 1 < args.length) launcher.parameters.put("port", args[++index]);
        }
        EventQueue.invokeAndWait(new Runnable() {
            public void run() {
                launcher.frame = new Frame("Minecraft");
                launcher.frame.setLayout(new BorderLayout());
                instance.setStub(launcher);
                instance.setPreferredSize(new Dimension(Integer.parseInt(args[3]), Integer.parseInt(args[4])));
                launcher.frame.add(instance, BorderLayout.CENTER);
                launcher.frame.pack();
                launcher.frame.setLocationRelativeTo(null);
                launcher.frame.addWindowListener(new WindowAdapter() {
                    public void windowClosing(WindowEvent event) {
                        launcher.active = false;
                        // Minecraft останавливает игровой поток в destroy().
                        new Thread(new Runnable() {
                            public void run() {
                                try { instance.stop(); instance.destroy(); }
                                finally { launcher.frame.dispose(); System.exit(0); }
                            }
                        }, "xnlc-legacy-shutdown").start();
                    }
                });
                launcher.frame.setVisible(true);
                launcher.active = true;
                instance.init();
                instance.start();
            }
        });
    }

    private static void invokeMain(Class<?> minecraft, String[] args) throws Exception {
        String[] gameArgs = new String[args.length - 6];
        System.arraycopy(args, 6, gameArgs, 0, gameArgs.length);
        try { minecraft.getMethod("main", String[].class).invoke(null, (Object) gameArgs); }
        catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            if (cause instanceof Error) throw (Error) cause;
            throw error;
        }
    }

    public boolean isActive() { return active; }
    public URL getDocumentBase() { return getCodeBase(); }
    public URL getCodeBase() {
        try { return new File(System.getProperty("user.dir")).toURI().toURL(); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
    public String getParameter(String name) { return parameters.get(name); }
    public AppletContext getAppletContext() { return this; }
    public void appletResize(final int width, final int height) {
        EventQueue.invokeLater(new Runnable() {
            public void run() { applet.setPreferredSize(new Dimension(width, height)); frame.pack(); }
        });
    }
    public AudioClip getAudioClip(URL url) { return Applet.newAudioClip(url); }
    public java.awt.Image getImage(URL url) { return java.awt.Toolkit.getDefaultToolkit().getImage(url); }
    public Applet getApplet(String name) { return applet; }
    public Enumeration<Applet> getApplets() { return Collections.enumeration(Collections.singleton(applet)); }
    public void showDocument(URL url) { showDocument(url, "_blank"); }
    public void showDocument(URL url, String target) { }
    public void showStatus(String status) { System.out.println(status); }
    public void setStream(String key, InputStream stream) {
        if (stream == null) streams.remove(key); else streams.put(key, stream);
    }
    public InputStream getStream(String key) { return streams.get(key); }
    public Iterator<String> getStreamKeys() { return streams.keySet().iterator(); }
}
