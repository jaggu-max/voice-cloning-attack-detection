package com.voiceguard.bridge

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.OutputStream
import java.net.Socket
import kotlin.concurrent.thread

/**
 * VoiceGuard USB Audio Bridge — Android companion app
 *
 * This Activity:
 *  1. Requests RECORD_AUDIO permission
 *  2. Connects to the laptop USB receiver via TCP socket on localhost:9876
 *     (ADB reverse tunnel: `adb reverse tcp:9876 tcp:9876` makes this work over USB)
 *  3. Captures microphone audio at 16kHz mono Int16
 *  4. Sends raw PCM data over the socket with a simple handshake
 *  5. Displays connection/audio status
 *
 * Build requirements:
 *  - Android API 21+
 *  - minSdk 21
 *  - Manifest permission: android.permission.RECORD_AUDIO
 *  - Manifest permission: android.permission.INTERNET
 *
 * Usage:
 *  1. adb reverse tcp:9876 tcp:9876          (on laptop BEFORE launching app)
 *  2. python usb_receiver/receiver.py        (on laptop)
 *  3. Launch this app on Android phone
 *  4. Tap START AUDIO
 */
class MainActivity : AppCompatActivity() {

    companion object {
        const val SAMPLE_RATE = 16000
        const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
        const val LAPTOP_HOST = "127.0.0.1"   // ADB reverse tunnel endpoint
        const val LAPTOP_PORT = 9876
        const val MAGIC = "VGAB"               // Handshake magic bytes
        const val REQUEST_RECORD_AUDIO = 101
    }

    private var audioRecord: AudioRecord? = null
    private var socket: Socket? = null
    private var outputStream: OutputStream? = null
    private var isStreaming = false
    private var recordThread: Thread? = null

    private lateinit var tvConnStatus: TextView
    private lateinit var tvMicStatus: TextView
    private lateinit var tvAudioLevel: TextView
    private lateinit var btnStart: Button
    private lateinit var btnStop: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvConnStatus = findViewById(R.id.tvConnStatus)
        tvMicStatus = findViewById(R.id.tvMicStatus)
        tvAudioLevel = findViewById(R.id.tvAudioLevel)
        btnStart = findViewById(R.id.btnStart)
        btnStop = findViewById(R.id.btnStop)

        btnStop.isEnabled = false

        btnStart.setOnClickListener { startStreaming() }
        btnStop.setOnClickListener  { stopStreaming() }

        requestMicPermission()
    }

    private fun requestMicPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_RECORD_AUDIO
            )
        } else {
            setStatus(tvMicStatus, "✓ Ready", okColor())
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_RECORD_AUDIO) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                setStatus(tvMicStatus, "✓ Ready", okColor())
            } else {
                setStatus(tvMicStatus, "✗ Permission denied", errColor())
            }
        }
    }

    private fun startStreaming() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            setStatus(tvMicStatus, "✗ No permission", errColor())
            return
        }

        btnStart.isEnabled = false
        isStreaming = true

        recordThread = thread(name="VoiceGuard-USB") {
            try {
                // 1. Connect to laptop USB receiver
                runOnUiThread { setStatus(tvConnStatus, "Connecting...", warnColor()) }
                socket = Socket(LAPTOP_HOST, LAPTOP_PORT)
                outputStream = socket!!.getOutputStream()

                // 2. Send handshake magic
                outputStream!!.write(MAGIC.toByteArray(Charsets.US_ASCII))
                outputStream!!.flush()

                // 3. Wait for ACK
                val ack = ByteArray(4)
                socket!!.getInputStream().read(ack)
                if (String(ack) != "VGOK") {
                    throw Exception("Invalid server ACK: ${String(ack)}")
                }

                runOnUiThread {
                    setStatus(tvConnStatus, "✓ Connected", okColor())
                    btnStop.isEnabled = true
                }

                // 4. Set up AudioRecord
                val bufSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)
                val recorder = AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT, bufSize * 4
                )
                audioRecord = recorder
                recorder.startRecording()
                runOnUiThread { setStatus(tvMicStatus, "✓ Recording", okColor()) }

                // 5. Stream PCM data
                val buf = ByteArray(bufSize * 2)
                while (isStreaming) {
                    val bytesRead = recorder.read(buf, 0, buf.size)
                    if (bytesRead > 0) {
                        outputStream!!.write(buf, 0, bytesRead)
                        outputStream!!.flush()

                        // Simple amplitude display
                        val shorts = ShortArray(bytesRead / 2)
                        java.nio.ByteBuffer.wrap(buf, 0, bytesRead)
                            .order(java.nio.ByteOrder.LITTLE_ENDIAN)
                            .asShortBuffer().get(shorts)
                        val rms = Math.sqrt(shorts.map { it.toDouble() * it.toDouble() }.average())
                        val level = (rms / Short.MAX_VALUE * 100).toInt().coerceIn(0, 100)
                        runOnUiThread {
                            val bar = "█".repeat(level / 10) + "░".repeat(10 - level / 10)
                            tvAudioLevel.text = "[$bar] $level%"
                        }
                    }
                }

                recorder.stop()
                recorder.release()
                audioRecord = null

            } catch (e: Exception) {
                runOnUiThread {
                    setStatus(tvConnStatus, "✗ Error: ${e.message}", errColor())
                }
            } finally {
                isStreaming = false
                closeConnection()
                runOnUiThread {
                    btnStart.isEnabled = true
                    btnStop.isEnabled = false
                    setStatus(tvMicStatus, "✓ Ready", okColor())
                }
            }
        }
    }

    private fun stopStreaming() {
        isStreaming = false
    }

    private fun closeConnection() {
        try { outputStream?.close() } catch (_: Exception) {}
        try { socket?.close() }       catch (_: Exception) {}
        outputStream = null
        socket = null
        runOnUiThread {
            setStatus(tvConnStatus, "Disconnected", errColor())
        }
    }

    private fun setStatus(tv: TextView, text: String, color: Int) {
        tv.text = text
        tv.setTextColor(color)
    }

    private fun okColor()   = android.graphics.Color.parseColor("#15803d")
    private fun errColor()  = android.graphics.Color.parseColor("#b91c1c")
    private fun warnColor() = android.graphics.Color.parseColor("#92400e")

    override fun onDestroy() {
        super.onDestroy()
        stopStreaming()
    }
}
