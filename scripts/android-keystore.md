# Android release signing

The APK that `.github/workflows/build.yml` builds is signed with a release key so phones accept updates
in place (a differently signed APK would have to be uninstalled first). The key lives next to the updater
key and never enters the repository:

- `~/.tauri/tcuflow-android.jks` — keystore, alias `tcuflow`
- `~/.tauri/tcuflow-android.password` — its password (store and key)

Made once with:

```sh
keytool -genkeypair -keystore ~/.tauri/tcuflow-android.jks -storepass "$(cat ~/.tauri/tcuflow-android.password)" \
  -keypass "$(cat ~/.tauri/tcuflow-android.password)" -alias tcuflow -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=TCuFlow, O=TCuFlow, C=ID"
```

The workflow reads it from two repository secrets. Set them (once) with:

```sh
base64 -i ~/.tauri/tcuflow-android.jks | gh secret set ANDROID_KEYSTORE_B64
gh secret set ANDROID_KEYSTORE_PASSWORD < ~/.tauri/tcuflow-android.password
```

Without the secrets the workflow still builds, but the APK is unsigned and won't install.

Local builds use the same key through `src-tauri/gen/android/keystore.properties` (git-ignored):

```
storeFile=/Users/<you>/.tauri/tcuflow-android.jks
password=<contents of tcuflow-android.password>
keyAlias=tcuflow
```

Losing the keystore means every phone has to uninstall before the next update: back it up with the updater key.
