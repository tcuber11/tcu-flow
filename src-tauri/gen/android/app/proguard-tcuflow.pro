# Injector runs by class name through app_process, TcuflowPlugin and the receiver are found by name; libadb and
# conscrypt reach their own classes reflectively
-keep class dev.tcuflow.app.** { *; }
-keep class io.github.muntashirakon.** { *; }
-keep class org.conscrypt.** { *; }
-keep class sun.security.** { *; }
-dontwarn **
