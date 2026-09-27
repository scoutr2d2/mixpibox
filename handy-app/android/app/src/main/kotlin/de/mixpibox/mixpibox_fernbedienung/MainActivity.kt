package de.mixpibox.mixpibox_fernbedienung

import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * Ein einziger Kanal, `de.mixpibox/ablage`: wohin die App zwischenspeichert,
 * und wie eine fertige Datei in den Download-Ordner des Handys kommt.
 *
 * WARUM SELBST UND KEIN PAKET: es sind zwei Handgriffe. Der Download selbst
 * laeuft in Dart ueber den BoxClient (Sitzung, gemerktes Zeugnis); hier wird
 * nur abgelegt.
 *
 * AB ANDROID 10 UEBER DEN MEDIASTORE, ohne Berechtigung: die Datei landet in
 * `Download/MixPiBox` und ist in „Dateien" und jedem Dateimanager sichtbar.
 * Darunter (Android 7–9) braeuchte der oeffentliche Ordner eine Berechtigung;
 * dort bleibt die Datei im App-eigenen Download-Ordner, und die App nennt
 * den Pfad.
 */
class MainActivity : FlutterActivity() {
    /**
     * TEILEN (27.09.2026): ein Text, den eine andere App (Spotify) an die
     * MixPiBox geteilt hat. Beim KALTSTART wartet er hier, bis Dart ihn mit
     * `abholen` holt — Flutter ist beim Start noch nicht bereit, ihn zu
     * hoeren. Laeuft die App schon, kommt er ueber `onNewIntent` und geht
     * sofort als `geteilt` an Dart.
     *
     * `singleTask`, NICHT `singleTop`: mit singleTop legte Android beim
     * Teilen aus Spotify eine ZWEITE MainActivity samt eigener Flutter-
     * Engine in Spotifys Task — zwei Apps nebeneinander, und die zweite
     * ohne den Stand der ersten (am Geraet 27.09.2026: die Profil-Auswahl
     * fehlte dort, weil nur die erste Instanz den neuen Code hatte).
     */
    private var geteilt: String? = null
    private var teilenKanal: MethodChannel? = null

    private fun textAus(i: Intent?): String? =
        if (i?.action == Intent.ACTION_SEND && i.type?.startsWith("text/") == true) i.getStringExtra(Intent.EXTRA_TEXT) else null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        textAus(intent)?.let { geteilt = it }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val text = textAus(intent) ?: return
        val kanal = teilenKanal
        if (kanal != null) kanal.invokeMethod("geteilt", text) else geteilt = text
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        teilenKanal = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "de.mixpibox/teilen").also { k ->
            k.setMethodCallHandler { aufruf, antwort ->
                if (aufruf.method == "abholen") {
                    antwort.success(geteilt)
                    geteilt = null
                } else {
                    antwort.notImplemented()
                }
            }
        }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "de.mixpibox/ablage").setMethodCallHandler { aufruf, antwort ->
            when (aufruf.method) {
                "zwischenOrdner" -> antwort.success(cacheDir.absolutePath)
                "inDownloads" -> {
                    val pfad = aufruf.argument<String>("pfad")
                    val name = aufruf.argument<String>("name")
                    if (pfad == null || name == null) {
                        antwort.error("argumente", "pfad und name fehlen", null)
                        return@setMethodCallHandler
                    }
                    try {
                        antwort.success(ablegen(File(pfad), name))
                    } catch (e: Exception) {
                        antwort.error("ablegen", e.message, null)
                    }
                }
                else -> antwort.notImplemented()
            }
        }
    }

    /** Legt [quelle] als [name] ab, loescht die Zwischendatei und nennt den Ort. */
    private fun ablegen(quelle: File, name: String): String {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val werte = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, "application/zip")
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MixPiBox")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val ziel = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, werte)
                    ?: throw IllegalStateException("Download-Ordner nicht beschreibbar")
                contentResolver.openOutputStream(ziel).use { aus ->
                    requireNotNull(aus) { "Download-Ordner nicht beschreibbar" }
                    quelle.inputStream().use { it.copyTo(aus) }
                }
                werte.clear()
                werte.put(MediaStore.Downloads.IS_PENDING, 0)
                contentResolver.update(ziel, werte, null, null)
                return "Download/MixPiBox/$name"
            }
            val ordner = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "MixPiBox").apply { mkdirs() }
            val ziel = File(ordner, name)
            quelle.copyTo(ziel, overwrite = true)
            return ziel.absolutePath
        } finally {
            quelle.delete()
        }
    }
}
