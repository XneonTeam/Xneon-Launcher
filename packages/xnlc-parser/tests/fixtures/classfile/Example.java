package net.minecraftforge.fml.common;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

@Retention(RetentionPolicy.RUNTIME)
@interface Mod {
    String value();
    int number();
    String[] aliases();
    Class<?> target();
}

@Retention(RetentionPolicy.CLASS)
@interface Hidden { boolean value(); }

@Mod(value = "example\0😀", number = 42, aliases = {"first", "second"}, target = String.class)
@Hidden(true)
public class Example implements Runnable {
    public void run() {}
}
