package app.sheepfold.android.router

/*
 * Ручной packet-level gate для явно разрешённого тестового телефона и роутера
 * Привязывает TCP/HTTP/HTTPS к Wi-Fi Network, исключая cellular и VPN как обход теста
 * Короткие запросы либо два сохранённых TLS-соединения без credentials и изменения настроек
 * В режиме established оператор меняет политику за 30 секунд после TRAFFIC_READY
 * Ошибка DNS не засчитывается как доказательство блокировки интернета
 * Не проверяет QUIC, произвольные VPN и все существующие соединения §routerharness §andlab1
 */
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException
import java.net.InetSocketAddress
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

@RunWith(AndroidJUnit4::class)
class InternetPolicyLiveTest {
    @Test fun wifiTrafficMatchesExpectedPolicy() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("Manual live traffic gate only", args.getString("liveTraffic") == "1")
        val expected = requireNotNull(args.getString("trafficExpected"))
        require(expected in listOf("open", "blocked"))
        val router = requireNotNull(args.getString("trafficRouter"))
        require(router.matches(Regex("192\\.168\\.[0-9]{1,3}\\.[0-9]{1,3}")))
        val expectedLan = requireNotNull(args.getString("trafficLan"))
        require(expectedLan in listOf("open", "blocked"))
        val scope = args.getString("trafficScope") ?: "all"
        require(scope in listOf("all", "direct"))
        val connectivity = instrumentation.targetContext
            .getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val wifi = connectivity.allNetworks.singleOrNull { network ->
            val capabilities = connectivity.getNetworkCapabilities(network)
            capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) &&
                connectivity.getLinkProperties(network)?.routes?.any { it.gateway?.hostAddress == router } == true
        }
        assertNotNull("Exactly one Wi-Fi network must use the explicit test router", wifi)
        val network = requireNotNull(wifi)
        val established = args.getString("trafficEstablished") ?: "0"
        require(established in listOf("0", "1"))
        if (established == "1") {
            require(scope == "all")
            establishedTraffic(network, expected == "open")
            return
        }
        val results = mutableListOf<Triple<String, Boolean, Boolean>>()
        val dnsFailures = mutableListOf<String>()

        fun probe(label: String, shouldWork: Boolean, operation: () -> Unit) {
            val failure = try {
                operation()
                null
            } catch (error: IOException) {
                // Недоступный DNS не доказывает применение запрета к трафику устройства
                if (error is UnknownHostException) dnsFailures += label
                error.javaClass.simpleName
            }
            val success = failure == null
            results += Triple(label, shouldWork, success)
            instrumentation.sendStatus(0, Bundle().apply {
                putString("stream", "TRAFFIC_PROBE $label expected=$shouldWork actual=$success error=${failure ?: "none"}\n")
            })
        }

        fun tcp(host: String, port: Int) {
            network.socketFactory.createSocket().use { socket ->
                socket.connect(InetSocketAddress(host, port), 4_000)
            }
        }

        fun https(address: String) {
            val connection = network.openConnection(URL(address)) as HttpsURLConnection
            try {
                connection.connectTimeout = 5_000
                connection.readTimeout = 5_000
                connection.instanceFollowRedirects = false
                connection.setRequestProperty("Cache-Control", "no-cache")
                if (connection.responseCode !in 200..399) throw IOException("Unexpected HTTP status")
            } finally {
                connection.disconnect()
            }
        }

        probe("routerHttp", expectedLan == "open") { tcp(router, 80) }
        probe("directIpv4Tcp", expected == "open") { tcp("1.1.1.1", 443) }
        probe("directIpv4Http", expected == "open") {
            network.socketFactory.createSocket().use { socket ->
                socket.connect(InetSocketAddress("1.1.1.1", 80), 4_000)
                socket.soTimeout = 5_000
                socket.getOutputStream().write(
                    "GET / HTTP/1.1\r\nHost: 1.1.1.1\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII)
                )
                val header = ByteArray(256)
                val length = socket.getInputStream().read(header)
                if (length < 5 || !String(header, 0, length, Charsets.US_ASCII).startsWith("HTTP/")) {
                    throw IOException("Missing HTTP response")
                }
            }
        }
        probe("httpsDirectDomain", expected == "open") { https("https://ya.ru/") }
        if (scope == "all") {
            probe("httpsProxyDomain", expected == "open") { https("https://www.gstatic.com/generate_204") }
        }
        instrumentation.sendStatus(0, Bundle().apply { putString("stream", "TRAFFIC_SCOPE $scope\n") })
        assertEquals("DNS failed; internet policy result is inconclusive", emptyList<String>(), dnsFailures)
        for ((label, shouldWork, success) in results) {
            assertEquals(label, shouldWork, success)
        }
    }

    private fun establishedTraffic(network: Network, shouldWork: Boolean) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val sockets = mutableListOf<Pair<String, SSLSocket>>()
        try {
            for (host in listOf("1.1.1.1", "www.gstatic.com")) {
                instrumentation.sendStatus(0, Bundle().apply { putString("stream", "TRAFFIC_CONNECTING $host\n") })
                val raw = network.socketFactory.createSocket()
                val socket = try {
                    raw.connect(InetSocketAddress(network.getByName(host), 443), 5_000)
                    (SSLSocketFactory.getDefault() as SSLSocketFactory)
                        .createSocket(raw, host, 443, true) as SSLSocket
                } catch (error: Exception) {
                    raw.close()
                    throw error
                }
                sockets += host to socket
                socket.soTimeout = 5_000
                socket.sslParameters = socket.sslParameters.apply { endpointIdentificationAlgorithm = "HTTPS" }
                socket.startHandshake()
                // Два ответа до смены политики подтверждают повторное использование одного сокета
                repeat(2) { keepAliveRequest(socket, host) }
            }
            instrumentation.sendStatus(0, Bundle().apply {
                putString("stream", "TRAFFIC_READY established=2 changeWindowSeconds=30\n")
            })
            Thread.sleep(30_000)
            val results = sockets.map { (host, socket) ->
                val failure = try {
                    keepAliveRequest(socket, host)
                    null
                } catch (error: IOException) {
                    error.javaClass.simpleName
                }
                val success = failure == null
                instrumentation.sendStatus(0, Bundle().apply {
                    putString("stream", "TRAFFIC_ESTABLISHED $host expected=$shouldWork actual=$success error=${failure ?: "none"}\n")
                })
                host to success
            }
            results.forEach { (host, success) -> assertEquals(host, shouldWork, success) }
        } finally {
            sockets.forEach { (_, socket) -> runCatching { socket.close() } }
        }
    }

    private fun keepAliveRequest(socket: SSLSocket, host: String) {
        socket.getOutputStream().apply {
            write("HEAD / HTTP/1.1\r\nHost: $host\r\nConnection: keep-alive\r\nCache-Control: no-cache\r\n\r\n".toByteArray(Charsets.US_ASCII))
            flush()
        }
        val header = StringBuilder()
        val input = socket.getInputStream()
        while (header.length < 16_384 && !header.endsWith("\r\n\r\n")) {
            val byte = input.read()
            if (byte < 0) throw IOException("Connection closed before response")
            header.append(byte.toChar())
        }
        if (!header.endsWith("\r\n\r\n")) throw IOException("Header too large")
        val status = header.toString().substringBefore("\r\n")
        if (!status.matches(Regex("HTTP/1\\.[01] [234][0-9]{2}.*"))) throw IOException("Unexpected HTTP status")
        if (Regex("(?im)^Connection:.*close").containsMatchIn(header)) throw IOException("Server cannot keep connection")
    }
}
