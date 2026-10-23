package net.minecraft;

import java.applet.Applet;
import java.applet.AppletStub;
import java.awt.BorderLayout;

/** Контракт старого FML: родитель MinecraftApplet обязан иметь replace(Applet). */
public final class Launcher extends Applet implements AppletStub {
    private Applet current;

    public Launcher(Applet initial) {
        setLayout(new BorderLayout());
        attach(initial);
    }

    private void attach(Applet next) {
        current = next;
        next.setStub(this);
        add(next, BorderLayout.CENTER);
    }

    // Имя и сигнатуру читает FMLRelauncher через reflection.
    public void replace(Applet next) {
        removeAll();
        attach(next);
        next.setSize(getSize());
        validate();
        next.init();
        next.start();
    }

    public void init() { current.init(); }
    public void start() { current.start(); }
    public void stop() { current.stop(); }
    public void destroy() { current.destroy(); }
    public void appletResize(int width, int height) { current.setSize(width, height); }
}
