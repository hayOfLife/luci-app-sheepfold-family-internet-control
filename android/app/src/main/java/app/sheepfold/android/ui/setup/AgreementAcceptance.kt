package app.sheepfold.android.ui.setup

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import app.sheepfold.android.R

/**
 * Редакция меняется только при существенном изменении соглашения. Время нужно
 * для локального аудита согласия; ни редакция, ни время не отправляются наружу.
 */
object AgreementAcceptanceStore {
    const val CURRENT_REVISION = "2026-08-24"
    private const val PREFS = "sheepfold_agreement"
    private const val KEY_REVISION = "accepted_revision"
    private const val KEY_ACCEPTED_AT = "accepted_at_millis"

    fun isCurrent(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getString(KEY_REVISION, null) == CURRENT_REVISION &&
            prefs.getLong(KEY_ACCEPTED_AT, 0L) > 0L
    }

    fun accept(context: Context, acceptedAtMillis: Long = System.currentTimeMillis()) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_REVISION, CURRENT_REVISION)
            .putLong(KEY_ACCEPTED_AT, acceptedAtMillis)
            .apply()
    }
}

/** Повторное согласие не смешивается с разрешениями Android и сопряжением. */
@Composable
fun AgreementRenewalScreen(onAccepted: () -> Unit) {
    val context = LocalContext.current
    var accepted by remember { mutableStateOf(false) }
    val agreementText = agreementAnnotatedText()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(stringResource(R.string.agreement_updated_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.agreement_updated_body))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Checkbox(
                checked = accepted,
                onCheckedChange = { accepted = it },
                modifier = Modifier.size(52.dp)
            )
            Text(
                text = agreementText,
                modifier = Modifier
                    .weight(1f)
                    .clickable {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(AGREEMENT_URL)))
                }
            )
        }
        Button(
            enabled = accepted,
            onClick = {
                AgreementAcceptanceStore.accept(context)
                onAccepted()
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(stringResource(R.string.agreement_accept_updated))
        }
    }
}

@Composable
private fun agreementAnnotatedText() = buildAnnotatedString {
    append(stringResource(R.string.setup_agreement_prefix))
    withStyle(
        SpanStyle(
            color = MaterialTheme.colorScheme.primary,
            textDecoration = TextDecoration.Underline
        )
    ) {
        append(stringResource(R.string.setup_agreement_link))
    }
    append(stringResource(R.string.setup_agreement_suffix))
}

const val AGREEMENT_URL =
    "https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control/blob/main/docs/user-agreement.ru.md"
