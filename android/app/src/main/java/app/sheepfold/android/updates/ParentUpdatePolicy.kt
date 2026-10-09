package app.sheepfold.android.updates

import java.net.URI

internal data class ParentRelease(val version: String, val url: String, val size: Long, val sha256: String)
internal data class AppIdentity(val packageName: String, val versionCode: Long, val versionName: String, val signers: Set<String>)

/** Независимый от роутера канал: GitHub доставляет файл, доверие задаёт подпись уже установленного APK. */
internal object ParentUpdatePolicy {
    const val repository = "hayOfLife/luci-app-sheepfold-family-internet-control"
    const val releasesUrl = "https://api.github.com/repos/$repository/releases?per_page=20"
    const val maxApkBytes = 128L * 1024 * 1024
    const val maxMetadataBytes = 1024L * 1024
    private val versionPattern = Regex("(0|[1-9][0-9]{0,5})(?:\\.(0|[1-9][0-9]{0,5})){1,3}")
    private val assetPattern = Regex("sheepfold-parent-v(.+)\\.apk")
    private val digestPattern = Regex("sha256:([0-9a-fA-F]{64})")
    private val assetHosts = setOf("release-assets.githubusercontent.com", "objects.githubusercontent.com")

    fun versionParts(version: String): List<Int>? =
        if (versionPattern.matches(version)) version.split('.').map(String::toInt) else null

    fun compareVersions(left: String, right: String): Int? {
        val a = versionParts(left) ?: return null
        val b = versionParts(right) ?: return null
        return (0..3).map { (a.getOrNull(it) ?: 0).compareTo(b.getOrNull(it) ?: 0) }
            .firstOrNull { it != 0 } ?: 0
    }

    fun release(name: String, url: String, size: Long, digest: String): ParentRelease? {
        val version = assetPattern.matchEntire(name)?.groupValues?.get(1) ?: return null
        if (versionParts(version) == null || size !in 1..maxApkBytes) return null
        val hash = digestPattern.matchEntire(digest)?.groupValues?.get(1)?.lowercase() ?: return null
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        if (!allowedDownloadUrl(url) || uri.host != "github.com" || uri.rawQuery != null) return null
        val prefix = "/$repository/releases/download/"
        val tail = uri.rawPath.removePrefix(prefix).split('/')
        if (!uri.rawPath.startsWith(prefix) || tail.size != 2 || tail[0].isBlank() || tail[1] != name) return null
        return ParentRelease(version, url, size, hash)
    }

    fun allowedDownloadUrl(url: String): Boolean {
        val uri = runCatching { URI(url) }.getOrNull() ?: return false
        if (uri.scheme != "https" || uri.rawUserInfo != null || uri.rawFragment != null || uri.port !in listOf(-1, 443)) return false
        return uri.host in assetHosts || (uri.host == "github.com" &&
            uri.rawPath.startsWith("/$repository/releases/download/") &&
            !uri.rawPath.contains("..") && !uri.rawPath.contains("%", ignoreCase = true))
    }

    fun acceptsArchive(installed: AppIdentity, archive: AppIdentity, release: ParentRelease): Boolean =
        installed.packageName == "app.sheepfold.android" &&
            archive.packageName == installed.packageName &&
            archive.versionCode > installed.versionCode &&
            archive.versionName == release.version &&
            compareVersions(archive.versionName, installed.versionName)?.let { it > 0 } == true &&
            installed.signers.isNotEmpty() && archive.signers == installed.signers
}
