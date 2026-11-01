package dev.tcuflow.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

/** The pairing code typed into TCuFlow's notification while Settings shows it. */
class PairReplyReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val code = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(KEY)?.toString() ?: return
    TcuflowPlugin.instance?.pair(code)
  }

  companion object {
    const val KEY = "code"
  }
}
